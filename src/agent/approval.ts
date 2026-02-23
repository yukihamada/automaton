/**
 * Approval Gate — Human-in-the-Loop Approval System
 *
 * Intercepts "quarantine" policy decisions and converts them into
 * asynchronous approval requests that require human confirmation
 * before the tool call is executed.
 *
 * The gate sits between PolicyEngine.evaluate() and tool execution:
 *   PolicyEngine → quarantine → ApprovalGate → pending/approved/denied
 *
 * Approval state is persisted in SQLite so it survives agent restarts.
 */

import { createHash } from "crypto";
import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type {
  PolicyDecision,
  RiskLevel,
} from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("approval");

// ─── Types ──────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface ApprovalRequest {
  id: string;
  turnId: string | null;
  toolName: string;
  toolArgs: Record<string, unknown>;
  argsHash: string;
  policyReason: string;
  humanMessage: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  expiresAt: string;
}

export interface ApprovalNotification {
  id: string;
  approvalId: string;
  channel: string;
  recipient: string;
  messageId: string | null;
  status: "sent" | "delivered" | "failed" | "retrying";
  attempt: number;
  sentAt: string;
  error: string | null;
}

export interface ApprovalGateConfig {
  /** Default TTL for approval requests in milliseconds. Default: 1 hour. */
  defaultTtlMs: number;
  /** TTL for dangerous tool calls. Default: 30 minutes. */
  dangerousTtlMs: number;
  /** TTL for self-modification operations. Default: 2 hours. */
  selfModTtlMs: number;
  /** Maximum retry attempts for failed notifications. Default: 3. */
  maxNotificationRetries: number;
  /** Age in ms before a pending request is considered stale for re-notification. Default: 15 min. */
  staleThresholdMs: number;
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalGateConfig = {
  defaultTtlMs: 60 * 60 * 1000,         // 1 hour
  dangerousTtlMs: 30 * 60 * 1000,       // 30 minutes
  selfModTtlMs: 2 * 60 * 60 * 1000,     // 2 hours
  maxNotificationRetries: 3,
  staleThresholdMs: 15 * 60 * 1000,      // 15 minutes
};

// Categories of tools that get extended TTL for self-modification
const SELF_MOD_TOOLS = new Set([
  "edit_own_file",
  "install_npm_package",
  "install_mcp_server",
  "install_skill",
  "create_skill",
  "remove_skill",
  "update_genesis_prompt",
  "pull_upstream",
  "git_commit",
  "git_push",
]);

// ─── Notifier Interface ─────────────────────────────────────────

/**
 * Interface for sending approval notifications to humans.
 * Implementations: LINEApprovalNotifier, etc.
 */
export interface ApprovalNotifier {
  /**
   * Send an approval request notification.
   * Returns the external message ID (e.g. LINE message ID) on success.
   */
  sendApprovalRequest(request: ApprovalRequest): Promise<string | null>;

  /**
   * Send a notification that an approval was resolved (for confirmation).
   */
  sendResolutionNotice(request: ApprovalRequest): Promise<void>;
}

// ─── ApprovalGate Class ─────────────────────────────────────────

export class ApprovalGate {
  private db: Database.Database;
  private config: ApprovalGateConfig;
  private notifier: ApprovalNotifier | null;

  constructor(
    db: Database.Database,
    config: Partial<ApprovalGateConfig> = {},
    notifier?: ApprovalNotifier,
  ) {
    this.db = db;
    this.config = { ...DEFAULT_APPROVAL_CONFIG, ...config };
    this.notifier = notifier ?? null;

    this.ensureTables();
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Request human approval for a quarantined tool call.
   *
   * If an identical pending request already exists (same tool + args hash),
   * returns that request instead of creating a duplicate.
   */
  requestApproval(
    decision: PolicyDecision,
    toolName: string,
    args: Record<string, unknown>,
    turnId?: string,
  ): ApprovalRequest {
    const argsHash = this.hashArgs(args);

    // Check for existing pending request with same signature
    const existing = this.findPendingByHash(toolName, argsHash);
    if (existing) {
      logger.info(`Reusing existing pending approval ${existing.id} for ${toolName}`);
      return existing;
    }

    const id = ulid();
    const now = new Date();
    const ttl = this.getTtl(toolName, decision.riskLevel);
    const expiresAt = new Date(now.getTime() + ttl);

    const request: ApprovalRequest = {
      id,
      turnId: turnId ?? null,
      toolName,
      toolArgs: args,
      argsHash,
      policyReason: decision.reasonCode,
      humanMessage: decision.humanMessage,
      riskLevel: decision.riskLevel,
      status: "pending",
      requestedAt: now.toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      expiresAt: expiresAt.toISOString(),
    };

    this.insertRequest(request);
    logger.info(
      `Approval requested: ${id} for ${toolName} (expires: ${expiresAt.toISOString()})`,
    );

    // Send notification asynchronously (fire-and-forget, errors logged)
    this.sendNotification(request).catch((err) => {
      logger.error(
        `Failed to send approval notification for ${id}`,
        err instanceof Error ? err : undefined,
      );
    });

    return request;
  }

  /**
   * Check the approval status for a specific tool call.
   *
   * Looks up by tool name + args hash. Returns the most recent
   * matching request, or null if none exists.
   */
  checkApproval(
    toolName: string,
    args: Record<string, unknown>,
  ): ApprovalRequest | null {
    const argsHash = this.hashArgs(args);
    return this.findByHash(toolName, argsHash);
  }

  /**
   * Resolve an approval request (approve or deny).
   *
   * Called by the webhook handler when a human taps Approve/Deny.
   * Returns the updated request, or null if the request was not
   * found or was already resolved.
   */
  resolveApproval(
    requestId: string,
    action: "approved" | "denied",
    resolvedBy: string,
  ): ApprovalRequest | null {
    const request = this.getRequestById(requestId);
    if (!request) {
      logger.warn(`Approval resolve failed: request ${requestId} not found`);
      return null;
    }

    if (request.status !== "pending") {
      logger.warn(
        `Approval resolve failed: request ${requestId} is already ${request.status}`,
      );
      return null;
    }

    // Check if expired
    if (new Date(request.expiresAt) <= new Date()) {
      this.expireRequest(requestId);
      logger.warn(`Approval resolve failed: request ${requestId} has expired`);
      return null;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = ?, resolved_at = ?, resolved_by = ?
         WHERE id = ?`,
      )
      .run(action, now, resolvedBy, requestId);

    const updated = this.getRequestById(requestId);
    logger.info(`Approval ${requestId} resolved: ${action} by ${resolvedBy}`);

    // Send resolution notice
    if (updated && this.notifier) {
      this.notifier.sendResolutionNotice(updated).catch((err) => {
        logger.error(
          `Failed to send resolution notice for ${requestId}`,
          err instanceof Error ? err : undefined,
        );
      });
    }

    return updated;
  }

  /**
   * Mark an approved request as consumed (so it can't be reused).
   *
   * Called after successful tool execution with an approved request.
   * Sets the status to 'cancelled' to prevent replay.
   */
  markConsumed(requestId: string): void {
    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = 'cancelled', resolved_at = COALESCE(resolved_at, datetime('now'))
         WHERE id = ? AND status = 'approved'`,
      )
      .run(requestId);
  }

  /**
   * Expire all timed-out pending requests.
   *
   * Returns the number of requests expired.
   */
  expireTimeouts(): number {
    const result = this.db
      .prepare(
        `UPDATE approval_requests
         SET status = 'expired', resolved_at = datetime('now'), resolved_by = 'system:timeout'
         WHERE status = 'pending' AND expires_at <= datetime('now')`,
      )
      .run();

    if (result.changes > 0) {
      logger.info(`Expired ${result.changes} pending approval(s)`);
    }

    return result.changes;
  }

  /**
   * Get all recently resolved approvals that the agent hasn't been notified about.
   *
   * Uses a KV flag to track the last notification timestamp. Returns approvals
   * resolved after that timestamp.
   */
  getResolvedApprovals(): ApprovalRequest[] {
    const lastCheck = this.getLastCheckTimestamp();
    const now = new Date().toISOString();

    const rows = this.db
      .prepare(
        `SELECT * FROM approval_requests
         WHERE status IN ('approved', 'denied', 'expired')
           AND resolved_at > ?
         ORDER BY resolved_at ASC`,
      )
      .all(lastCheck) as any[];

    // Update the checkpoint
    this.setLastCheckTimestamp(now);

    return rows.map((row) => this.rowToRequest(row));
  }

  /**
   * Get the count of currently pending approval requests.
   */
  getPendingCount(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM approval_requests WHERE status = 'pending'`,
      )
      .get() as { cnt: number };

    return row.cnt;
  }

  /**
   * Get pending requests older than the stale threshold that may need re-notification.
   */
  getStaleRequests(staleMs?: number): ApprovalRequest[] {
    const threshold = staleMs ?? this.config.staleThresholdMs;
    const cutoff = new Date(Date.now() - threshold).toISOString();

    const rows = this.db
      .prepare(
        `SELECT ar.* FROM approval_requests ar
         WHERE ar.status = 'pending'
           AND ar.requested_at <= ?
           AND ar.expires_at > datetime('now')
           AND (
             SELECT COUNT(*) FROM approval_notifications an
             WHERE an.approval_id = ar.id AND an.sent_at > ?
           ) = 0
         ORDER BY ar.requested_at ASC`,
      )
      .all(cutoff, cutoff) as any[];

    return rows.map((row) => this.rowToRequest(row));
  }

  /**
   * Resend a notification for a pending approval request.
   */
  async resendNotification(requestId: string): Promise<void> {
    const request = this.getRequestById(requestId);
    if (!request || request.status !== "pending") return;

    const attemptCount = this.getNotificationAttemptCount(requestId);
    if (attemptCount >= this.config.maxNotificationRetries) {
      logger.warn(
        `Max notification retries (${this.config.maxNotificationRetries}) reached for ${requestId}`,
      );
      return;
    }

    await this.sendNotification(request, attemptCount + 1);
  }

  /**
   * Get a single approval request by ID.
   */
  getRequestById(id: string): ApprovalRequest | null {
    const row = this.db
      .prepare(`SELECT * FROM approval_requests WHERE id = ?`)
      .get(id) as any | undefined;

    return row ? this.rowToRequest(row) : null;
  }

  // ─── Private Helpers ────────────────────────────────────────

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id            TEXT PRIMARY KEY,
        turn_id       TEXT,
        tool_name     TEXT NOT NULL,
        tool_args     TEXT NOT NULL DEFAULT '{}',
        args_hash     TEXT NOT NULL,
        policy_reason TEXT NOT NULL,
        human_message TEXT NOT NULL,
        risk_level    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','approved','denied','expired','cancelled')),
        requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at   TEXT,
        resolved_by   TEXT,
        expires_at    TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_approval_status
        ON approval_requests(status);
      CREATE INDEX IF NOT EXISTS idx_approval_args_hash
        ON approval_requests(args_hash, status);
      CREATE INDEX IF NOT EXISTS idx_approval_expires
        ON approval_requests(expires_at) WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS approval_notifications (
        id              TEXT PRIMARY KEY,
        approval_id     TEXT NOT NULL REFERENCES approval_requests(id),
        channel         TEXT NOT NULL DEFAULT 'line',
        recipient       TEXT NOT NULL,
        message_id      TEXT,
        status          TEXT NOT NULL DEFAULT 'sent'
                        CHECK(status IN ('sent','delivered','failed','retrying')),
        attempt         INTEGER NOT NULL DEFAULT 1,
        sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
        error           TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notification_approval
        ON approval_notifications(approval_id);
    `);
  }

  private hashArgs(args: Record<string, unknown>): string {
    return createHash("sha256")
      .update(JSON.stringify(args))
      .digest("hex");
  }

  private getTtl(toolName: string, riskLevel: RiskLevel): number {
    if (SELF_MOD_TOOLS.has(toolName)) {
      return this.config.selfModTtlMs;
    }
    if (riskLevel === "dangerous" || riskLevel === "forbidden") {
      return this.config.dangerousTtlMs;
    }
    return this.config.defaultTtlMs;
  }

  private insertRequest(request: ApprovalRequest): void {
    this.db
      .prepare(
        `INSERT INTO approval_requests
         (id, turn_id, tool_name, tool_args, args_hash, policy_reason, human_message,
          risk_level, status, requested_at, resolved_at, resolved_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.id,
        request.turnId,
        request.toolName,
        JSON.stringify(request.toolArgs),
        request.argsHash,
        request.policyReason,
        request.humanMessage,
        request.riskLevel,
        request.status,
        request.requestedAt,
        request.resolvedAt,
        request.resolvedBy,
        request.expiresAt,
      );
  }

  private findPendingByHash(
    toolName: string,
    argsHash: string,
  ): ApprovalRequest | null {
    const row = this.db
      .prepare(
        `SELECT * FROM approval_requests
         WHERE tool_name = ? AND args_hash = ? AND status = 'pending'
           AND expires_at > datetime('now')
         ORDER BY requested_at DESC LIMIT 1`,
      )
      .get(toolName, argsHash) as any | undefined;

    return row ? this.rowToRequest(row) : null;
  }

  private findByHash(
    toolName: string,
    argsHash: string,
  ): ApprovalRequest | null {
    // Return the most recent non-cancelled request (pending, approved, denied, expired)
    const row = this.db
      .prepare(
        `SELECT * FROM approval_requests
         WHERE tool_name = ? AND args_hash = ? AND status != 'cancelled'
         ORDER BY requested_at DESC LIMIT 1`,
      )
      .get(toolName, argsHash) as any | undefined;

    return row ? this.rowToRequest(row) : null;
  }

  private expireRequest(requestId: string): void {
    this.db
      .prepare(
        `UPDATE approval_requests
         SET status = 'expired', resolved_at = datetime('now'), resolved_by = 'system:timeout'
         WHERE id = ? AND status = 'pending'`,
      )
      .run(requestId);
  }

  private async sendNotification(
    request: ApprovalRequest,
    attempt: number = 1,
  ): Promise<void> {
    if (!this.notifier) {
      logger.debug("No notifier configured — skipping approval notification");
      return;
    }

    const notificationId = ulid();
    const recipient = "creator"; // Resolved by the notifier implementation

    try {
      const messageId = await this.notifier.sendApprovalRequest(request);

      this.db
        .prepare(
          `INSERT INTO approval_notifications
           (id, approval_id, channel, recipient, message_id, status, attempt, sent_at)
           VALUES (?, ?, 'line', ?, ?, 'sent', ?, datetime('now'))`,
        )
        .run(notificationId, request.id, recipient, messageId, attempt);
    } catch (err: any) {
      this.db
        .prepare(
          `INSERT INTO approval_notifications
           (id, approval_id, channel, recipient, status, attempt, sent_at, error)
           VALUES (?, ?, 'line', ?, 'failed', ?, datetime('now'), ?)`,
        )
        .run(
          notificationId,
          request.id,
          recipient,
          attempt,
          err.message || String(err),
        );

      throw err;
    }
  }

  private getNotificationAttemptCount(approvalId: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(attempt) as max_attempt FROM approval_notifications
         WHERE approval_id = ?`,
      )
      .get(approvalId) as { max_attempt: number | null };

    return row.max_attempt ?? 0;
  }

  private getLastCheckTimestamp(): string {
    const row = this.db
      .prepare(`SELECT value FROM kv WHERE key = 'approval_last_check'`)
      .get() as { value: string } | undefined;

    // Default to epoch if never checked
    return row?.value ?? "1970-01-01T00:00:00.000Z";
  }

  private setLastCheckTimestamp(timestamp: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at)
         VALUES ('approval_last_check', ?, datetime('now'))`,
      )
      .run(timestamp);
  }

  private rowToRequest(row: any): ApprovalRequest {
    let toolArgs: Record<string, unknown> = {};
    try {
      toolArgs = JSON.parse(row.tool_args);
    } catch {
      // Defensive: if tool_args is corrupt, use empty object
    }

    return {
      id: row.id,
      turnId: row.turn_id,
      toolName: row.tool_name,
      toolArgs,
      argsHash: row.args_hash,
      policyReason: row.policy_reason,
      humanMessage: row.human_message,
      riskLevel: row.risk_level as RiskLevel,
      status: row.status as ApprovalStatus,
      requestedAt: row.requested_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      expiresAt: row.expires_at,
    };
  }
}

// ─── Heartbeat Task ───────────────────────────────────────────

/**
 * Heartbeat task: check_pending_approvals
 *
 * Runs every 5 minutes. Expires timed-out requests, counts pending,
 * and re-sends notifications for stale requests.
 */
export async function checkPendingApprovals(
  approvalGate: ApprovalGate,
): Promise<string> {
  // 1. Expire timed-out requests
  const expired = approvalGate.expireTimeouts();

  // 2. Count pending
  const pendingCount = approvalGate.getPendingCount();

  // 3. Re-notify stale requests
  const stale = approvalGate.getStaleRequests();
  let renotified = 0;
  for (const req of stale) {
    try {
      await approvalGate.resendNotification(req.id);
      renotified++;
    } catch (err) {
      logger.error(
        `Re-notification failed for ${req.id}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  const summary = `Approvals: ${pendingCount} pending, ${expired} expired, ${renotified} re-notified`;
  logger.info(summary);
  return summary;
}
