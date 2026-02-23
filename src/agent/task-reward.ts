/**
 * Task Reward Manager
 *
 * Implements the ethical economy model: the automaton can accept tasks,
 * complete them for rewards, and track per-task profitability.
 *
 * Ethics enforcement ensures the agent only accepts work aligned with
 * its Constitution (Do no harm / Earn your existence / Never deceive).
 *
 * Integrates with SpendTracker for cost attribution and the existing
 * SQLite migration system for persistence.
 */

import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type { SpendTracker } from "./spend-tracker.js";

// ─── Interfaces ──────────────────────────────────────────────────

export type TaskStatus =
  | "open"
  | "claimed"
  | "in_progress"
  | "completed"
  | "rejected";

export type IncomeSourceType = "task_completion" | "tip" | "other";

export interface Task {
  id: string;
  creatorAddress: string;
  title: string;
  description: string;
  rewardCents: number;
  status: TaskStatus;
  agentAddress?: string;
  proof?: string;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  ethicsCheck: EthicsCheckResult;
}

export interface IncomeEvent {
  id: string;
  sourceType: IncomeSourceType;
  linkedTaskId?: string;
  amountCents: number;
  createdAt: string;
}

export interface EthicsCheckResult {
  allowed: boolean;
  reason?: string;
  category?: BlockedCategory;
  matchedPattern?: string;
}

export interface TaskCostAttribution {
  id: string;
  taskId: string;
  spendCategory: string;
  amountCents: number;
  description: string;
  createdAt: string;
}

export interface DailyProfitLoss {
  income: number;
  cost: number;
  net: number;
}

// ─── Blocked Task Categories ─────────────────────────────────────

export type BlockedCategory =
  | "spam"
  | "hacking"
  | "token_ico"
  | "harassment"
  | "deception"
  | "illegal";

interface BlockedCategoryEntry {
  category: BlockedCategory;
  patterns: RegExp[];
  reason: string;
}

/**
 * Blocked task categories with associated keyword patterns.
 * Each pattern is checked against the lowercased title + description.
 *
 * Constitution mapping:
 *   - Law 1 (Do no harm): spam, hacking, harassment, illegal
 *   - Law 3 (Never deceive): token_ico, deception
 */
const BLOCKED_CATEGORIES: BlockedCategoryEntry[] = [
  {
    category: "spam",
    patterns: [
      /\bspam\b/,
      /\bbulk\s+email\b/,
      /\bmass\s+messag/,
      /\bunsolicited\b/,
      /\bemail\s+blast\b/,
      /\bsms\s+blast\b/,
      /\bblast\s+campaign\b/,
      /\bspam\s+bot\b/,
      /\bsend\s+bulk\b/,
    ],
    reason: "Law 1: Do no harm -- spam harms recipients and degrades communication channels",
  },
  {
    category: "hacking",
    patterns: [
      /\bhack\b/,
      /\bexploit\b/,
      /\bbrute\s*force\b/,
      /\bddos\b/,
      /\bphishing\b/,
      /\bcredential\s*stuff/,
      /\bsql\s*inject/,
      /\bxss\s*attack/,
      /\bunauthorized\s+access/,
      /\bpenetration\s+test.*without.*permiss/,
      /\bcrack\s+password/,
      /\bbypass\s+auth/,
      /\bbackdoor\b/,
      /\bkeylogger\b/,
      /\bmalware\b/,
      /\bransomware\b/,
    ],
    reason: "Law 1: Do no harm -- unauthorized access violates systems and their users",
  },
  {
    category: "token_ico",
    patterns: [
      /\bcreate\s+token\b/,
      /\blaunch\s+token\b/,
      /\bmint\s+token\b/,
      /\bico\b/,
      /\binitial\s+coin\s+offering\b/,
      /\bpump\s+and\s+dump\b/,
      /\brug\s*pull\b/,
      /\bmeme\s*coin\b/,
      /\btoken\s+presale\b/,
      /\btoken\s+launch\b/,
    ],
    reason: "Law 3: Never deceive -- token creation and ICOs carry extreme fraud risk",
  },
  {
    category: "harassment",
    patterns: [
      /\bharass\b/,
      /\bstalk\b/,
      /\bdoxx?\b/,
      /\bbully\b/,
      /\bthreaten\b/,
      /\bintimidat/,
      /\brevenge\b/,
      /\btarget\s+(this\s+)?person\b/,
      /\bhate\s+speech\b/,
      /\bswatt?ing\b/,
    ],
    reason: "Law 1: Do no harm -- targeting individuals for harassment causes direct harm",
  },
  {
    category: "deception",
    patterns: [
      /\bfake\s+review/,
      /\bastroturf/,
      /\bimpersonat/,
      /\bforg(e|ery)\b/,
      /\bcounterfeit\b/,
      /\bdeepfake\b/,
      /\bfabricate\s+evidence\b/,
      /\bfalse\s+identity\b/,
      /\bfraudulent\b/,
    ],
    reason: "Law 3: Never deceive -- creating deceptive content violates trust",
  },
  {
    category: "illegal",
    patterns: [
      /\billegal\s+drug/,
      /\bweapon\s+(traffick|sell|manufactur)/,
      /\bcontraband\b/,
      /\blaunder\b/,
      /\bmoney\s+launder/,
      /\bchild\s+exploit/,
      /\bhuman\s+traffick/,
      /\bterroris/,
    ],
    reason: "Law 1: Do no harm -- illegal activities cause widespread harm",
  },
];

// ─── DB Row Types ────────────────────────────────────────────────

interface TaskRow {
  id: string;
  creator_address: string;
  title: string;
  description: string;
  reward_cents: number;
  status: string;
  agent_address: string | null;
  proof: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  ethics_check: string;
}

interface IncomeEventRow {
  id: string;
  source_type: string;
  linked_task_id: string | null;
  amount_cents: number;
  created_at: string;
}

interface TaskCostRow {
  id: string;
  task_id: string;
  spend_category: string;
  amount_cents: number;
  description: string;
  created_at: string;
}

// ─── Migration ───────────────────────────────────────────────────
// Schema migration lives in src/state/schema.ts as MIGRATION_V10.
// Tables: tasks, income_events, task_cost_attribution
// Applied automatically by the migration runner in database.ts.

// ─── Helpers ─────────────────────────────────────────────────────

function taskRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    creatorAddress: row.creator_address,
    title: row.title,
    description: row.description,
    rewardCents: row.reward_cents,
    status: row.status as TaskStatus,
    agentAddress: row.agent_address ?? undefined,
    proof: row.proof ?? undefined,
    createdAt: row.created_at,
    claimedAt: row.claimed_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    ethicsCheck: JSON.parse(row.ethics_check),
  };
}

function incomeRowToEvent(row: IncomeEventRow): IncomeEvent {
  return {
    id: row.id,
    sourceType: row.source_type as IncomeSourceType,
    linkedTaskId: row.linked_task_id ?? undefined,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
  };
}

/**
 * Get the current day window string in ISO format: '2026-02-23'
 * Matches the pattern used in SpendTracker.
 */
function getCurrentDayWindow(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── TaskRewardManager ──────────────────────────────────────────

export class TaskRewardManager {
  private db: Database.Database;
  private spendTracker: SpendTracker;

  constructor(db: Database.Database, spendTracker: SpendTracker) {
    this.db = db;
    this.spendTracker = spendTracker;
  }

  // ── Task Lifecycle ──────────────────────────────────────────

  /**
   * Create a new task. Runs ethics validation before accepting.
   * If the task fails ethics check, it is persisted with status 'rejected'.
   */
  createTask(
    input: Omit<Task, "id" | "status" | "createdAt" | "ethicsCheck">,
  ): Task {
    const id = ulid();
    const ethicsCheck = this.validateTaskEthics({
      id,
      ...input,
      status: "open",
      createdAt: "",
      ethicsCheck: { allowed: true },
    });

    const status: TaskStatus = ethicsCheck.allowed ? "open" : "rejected";
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");

    this.db
      .prepare(
        `INSERT INTO tasks (id, creator_address, title, description, reward_cents, status, ethics_check, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.creatorAddress,
        input.title,
        input.description,
        input.rewardCents,
        status,
        JSON.stringify(ethicsCheck),
        now,
      );

    return {
      id,
      creatorAddress: input.creatorAddress,
      title: input.title,
      description: input.description,
      rewardCents: input.rewardCents,
      status,
      createdAt: now,
      ethicsCheck,
    };
  }

  /**
   * Claim a task for execution by a specific agent.
   * Only tasks with status 'open' can be claimed.
   */
  claimTask(taskId: string, agentAddress: string): void {
    const row = this.db
      .prepare("SELECT status FROM tasks WHERE id = ?")
      .get(taskId) as { status: string } | undefined;

    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (row.status !== "open") {
      throw new Error(
        `Task ${taskId} cannot be claimed: current status is '${row.status}', expected 'open'`,
      );
    }

    const now = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    this.db
      .prepare(
        "UPDATE tasks SET status = 'claimed', agent_address = ?, claimed_at = ? WHERE id = ?",
      )
      .run(agentAddress, now, taskId);
  }

  /**
   * Mark a claimed/in_progress task as in_progress.
   * This is an optional intermediate state for long-running tasks.
   */
  startTask(taskId: string): void {
    const row = this.db
      .prepare("SELECT status FROM tasks WHERE id = ?")
      .get(taskId) as { status: string } | undefined;

    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (row.status !== "claimed") {
      throw new Error(
        `Task ${taskId} cannot be started: current status is '${row.status}', expected 'claimed'`,
      );
    }

    this.db
      .prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?")
      .run(taskId);
  }

  /**
   * Complete a task with proof of completion.
   * Records the income event and links it to the task.
   * Only tasks with status 'claimed' or 'in_progress' can be completed.
   */
  completeTask(taskId: string, proof: string): void {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as TaskRow | undefined;

    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (row.status !== "claimed" && row.status !== "in_progress") {
      throw new Error(
        `Task ${taskId} cannot be completed: current status is '${row.status}', expected 'claimed' or 'in_progress'`,
      );
    }

    const now = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");

    // Use a transaction to atomically update the task and record income
    const complete = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE tasks SET status = 'completed', proof = ?, completed_at = ? WHERE id = ?",
        )
        .run(proof, now, taskId);

      // Record the income event
      const incomeId = ulid();
      this.db
        .prepare(
          `INSERT INTO income_events (id, source_type, linked_task_id, amount_cents, created_at)
           VALUES (?, 'task_completion', ?, ?, ?)`,
        )
        .run(incomeId, taskId, row.reward_cents, now);
    });

    complete();
  }

  // ── Income Tracking ─────────────────────────────────────────

  /**
   * Record an income event (tip, task completion, or other).
   * For task completions, prefer using completeTask() which records
   * income automatically.
   */
  recordIncome(
    event: Omit<IncomeEvent, "id" | "createdAt">,
  ): IncomeEvent {
    const id = ulid();
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");

    this.db
      .prepare(
        `INSERT INTO income_events (id, source_type, linked_task_id, amount_cents, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, event.sourceType, event.linkedTaskId ?? null, event.amountCents, now);

    return {
      id,
      sourceType: event.sourceType,
      linkedTaskId: event.linkedTaskId,
      amountCents: event.amountCents,
      createdAt: now,
    };
  }

  // ── Cost Attribution ────────────────────────────────────────

  /**
   * Attribute a cost to a specific task.
   * Call this when the agent performs work (inference, tool use) on behalf
   * of a task to enable per-task profitability tracking.
   */
  attributeCost(
    taskId: string,
    spendCategory: string,
    amountCents: number,
    description: string = "",
  ): void {
    const id = ulid();
    const now = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");

    this.db
      .prepare(
        `INSERT INTO task_cost_attribution (id, task_id, spend_category, amount_cents, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, taskId, spendCategory, amountCents, description, now);
  }

  /**
   * Get the total cost attributed to a specific task.
   */
  getTaskCost(taskId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM task_cost_attribution WHERE task_id = ?",
      )
      .get(taskId) as { total: number };
    return row.total;
  }

  // ── Metrics ─────────────────────────────────────────────────

  /**
   * Compute the efficiency ratio for a completed task.
   * Returns reward / cost. A ratio > 1.0 means the task was profitable.
   * Returns Infinity if cost is 0 (free task completion).
   * Returns 0 if the task has no reward.
   */
  getEfficiencyRatio(taskId: string): number {
    const task = this.getTaskById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const cost = this.getTaskCost(taskId);
    if (cost === 0) {
      return task.rewardCents > 0 ? Infinity : 0;
    }
    return task.rewardCents / cost;
  }

  /**
   * Get today's profit/loss summary.
   * Income comes from income_events, cost comes from spend_tracking.
   */
  getDailyProfitLoss(): DailyProfitLoss {
    const today = getCurrentDayWindow();

    // Sum income for today
    // income_events.created_at is stored as 'YYYY-MM-DD HH:MM:SS'
    const incomeRow = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM income_events WHERE created_at LIKE ?",
      )
      .get(`${today}%`) as { total: number };

    // Sum all costs for today from spend_tracking (matches SpendTracker's window_day format)
    const costRow = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM spend_tracking WHERE window_day = ?",
      )
      .get(today) as { total: number };

    const income = incomeRow.total;
    const cost = costRow.total;

    return {
      income,
      cost,
      net: income - cost,
    };
  }

  // ── Ethics Enforcement ──────────────────────────────────────

  /**
   * Validate a task against the ethics rules.
   * Checks the task title and description against all blocked categories.
   *
   * Also enforces:
   * - Tasks must have a positive reward (Law 2: Earn your existence)
   * - Creator address must not be on the blocklist
   */
  validateTaskEthics(task: Task): EthicsCheckResult {
    // Law 2: Earn your existence -- reject zero/negative rewards
    if (task.rewardCents <= 0) {
      return {
        allowed: false,
        reason: "Law 2: Earn your existence -- tasks must offer a positive reward",
        category: undefined,
        matchedPattern: undefined,
      };
    }

    // Check creator blocklist (stored in KV as JSON array)
    const blocklist = this.getCreatorBlocklist();
    if (blocklist.includes(task.creatorAddress.toLowerCase())) {
      return {
        allowed: false,
        reason: "Creator address is on the blocklist",
        category: undefined,
        matchedPattern: undefined,
      };
    }

    // Normalize text for pattern matching
    const text = `${task.title} ${task.description}`.toLowerCase();

    // Check all blocked categories
    for (const entry of BLOCKED_CATEGORIES) {
      for (const pattern of entry.patterns) {
        if (pattern.test(text)) {
          return {
            allowed: false,
            reason: entry.reason,
            category: entry.category,
            matchedPattern: pattern.source,
          };
        }
      }
    }

    return { allowed: true };
  }

  // ── Query Helpers ───────────────────────────────────────────

  /**
   * Get a task by ID.
   */
  getTaskById(taskId: string): Task | undefined {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as TaskRow | undefined;

    return row ? taskRowToTask(row) : undefined;
  }

  /**
   * Get all tasks with a given status.
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC")
      .all(status) as TaskRow[];

    return rows.map(taskRowToTask);
  }

  /**
   * Get all tasks created by a specific address.
   */
  getTasksByCreator(creatorAddress: string): Task[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM tasks WHERE creator_address = ? ORDER BY created_at DESC",
      )
      .all(creatorAddress) as TaskRow[];

    return rows.map(taskRowToTask);
  }

  /**
   * Get recent income events.
   */
  getRecentIncome(limit: number = 50): IncomeEvent[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM income_events ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as IncomeEventRow[];

    return rows.map(incomeRowToEvent);
  }

  /**
   * Get the cost breakdown for a task.
   */
  getTaskCostBreakdown(taskId: string): TaskCostAttribution[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM task_cost_attribution WHERE task_id = ? ORDER BY created_at",
      )
      .all(taskId) as TaskCostRow[];

    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      spendCategory: row.spend_category,
      amountCents: row.amount_cents,
      description: row.description,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get total income since a given date.
   */
  getTotalIncome(since: Date): number {
    const sinceStr = since
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM income_events WHERE created_at >= ?",
      )
      .get(sinceStr) as { total: number };
    return row.total;
  }

  // ── Blocklist Management ────────────────────────────────────

  /**
   * Get the creator blocklist from the KV store.
   */
  private getCreatorBlocklist(): string[] {
    const raw = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get("task_creator_blocklist") as { value: string } | undefined;

    if (!raw) return [];

    try {
      return JSON.parse(raw.value) as string[];
    } catch {
      return [];
    }
  }

  /**
   * Add an address to the creator blocklist.
   */
  addToBlocklist(address: string): void {
    const current = this.getCreatorBlocklist();
    const normalized = address.toLowerCase();

    if (current.includes(normalized)) return;

    current.push(normalized);

    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run("task_creator_blocklist", JSON.stringify(current));
  }

  /**
   * Remove an address from the creator blocklist.
   */
  removeFromBlocklist(address: string): void {
    const current = this.getCreatorBlocklist();
    const normalized = address.toLowerCase();
    const updated = current.filter((a) => a !== normalized);

    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run("task_creator_blocklist", JSON.stringify(updated));
  }

  // ── Formatting ──────────────────────────────────────────────

  /**
   * Format a dollar amount from cents for display.
   */
  static formatCents(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  /**
   * Generate a human-readable summary of a task.
   */
  formatTaskSummary(task: Task): string {
    const lines = [
      `Task: ${task.title} [${task.id}]`,
      `  Creator: ${task.creatorAddress}`,
      `  Reward: ${TaskRewardManager.formatCents(task.rewardCents)}`,
      `  Status: ${task.status}`,
    ];

    if (task.status === "completed") {
      const cost = this.getTaskCost(task.id);
      const efficiency = cost > 0 ? (task.rewardCents / cost).toFixed(2) : "N/A";
      lines.push(`  Cost: ${TaskRewardManager.formatCents(cost)}`);
      lines.push(`  Efficiency: ${efficiency}x`);
    }

    if (!task.ethicsCheck.allowed) {
      lines.push(`  Rejected: ${task.ethicsCheck.reason}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate a daily P&L report.
   */
  formatDailyReport(): string {
    const pnl = this.getDailyProfitLoss();
    const openTasks = this.getTasksByStatus("open").length;
    const activeTasks =
      this.getTasksByStatus("claimed").length +
      this.getTasksByStatus("in_progress").length;
    const completedToday = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND completed_at LIKE ?",
      )
      .get(`${getCurrentDayWindow()}%`) as { count: number };

    return [
      "=== DAILY P&L REPORT ===",
      `Income:    ${TaskRewardManager.formatCents(pnl.income)}`,
      `Cost:      ${TaskRewardManager.formatCents(pnl.cost)}`,
      `Net:       ${TaskRewardManager.formatCents(pnl.net)} ${pnl.net >= 0 ? "(profit)" : "(loss)"}`,
      ``,
      `Open tasks:      ${openTasks}`,
      `Active tasks:    ${activeTasks}`,
      `Completed today: ${completedToday.count}`,
      "========================",
    ].join("\n");
  }
}
