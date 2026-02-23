/**
 * LINE Messaging Adapter — Approval Notifications
 *
 * Sends approval request notifications to the human operator via LINE
 * Messaging API push messages with Flex Message cards and quick-reply
 * Approve/Deny buttons.
 *
 * Handles:
 *  - Push notifications for new approval requests
 *  - Resolution confirmation messages
 *  - Webhook parsing for postback approve/deny actions
 *
 * Requires:
 *  - LINE_CHANNEL_ACCESS_TOKEN: Long-lived channel access token
 *  - LINE_CREATOR_USER_ID: The human operator's LINE user ID
 *
 * The LINE Messaging API reference:
 *  - Push: POST https://api.line.me/v2/bot/message/push
 *  - Reply: POST https://api.line.me/v2/bot/message/reply
 */

import type { ApprovalNotifier, ApprovalRequest } from "../agent/approval.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("line");

const LINE_API_BASE = "https://api.line.me/v2/bot";
const REQUEST_TIMEOUT_MS = 15_000;

// ─── Configuration ──────────────────────────────────────────────

export interface LINEConfig {
  /** LINE channel access token (long-lived). */
  channelAccessToken: string;
  /** LINE user ID of the human operator who approves/denies requests. */
  creatorUserId: string;
  /** Optional: Channel secret for webhook signature verification. */
  channelSecret?: string;
}

// ─── LINE Approval Notifier ─────────────────────────────────────

/**
 * Implements ApprovalNotifier for LINE Messaging API.
 *
 * Sends Flex Messages with tool call details and quick-reply
 * buttons for approve/deny actions.
 */
export class LINEApprovalNotifier implements ApprovalNotifier {
  private config: LINEConfig;

  constructor(config: LINEConfig) {
    this.config = config;

    if (!config.channelAccessToken) {
      throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");
    }
    if (!config.creatorUserId) {
      throw new Error("LINE_CREATOR_USER_ID is required");
    }
  }

  /**
   * Send an approval request notification as a LINE Flex Message.
   * Returns the LINE message ID on success, or null on failure.
   */
  async sendApprovalRequest(request: ApprovalRequest): Promise<string | null> {
    const flexMessage = this.buildApprovalFlexMessage(request);

    const payload = {
      to: this.config.creatorUserId,
      messages: [flexMessage],
    };

    try {
      const response = await this.pushMessage(payload);
      logger.info(`LINE approval notification sent for ${request.id}`);
      return response?.sentMessages?.[0]?.id ?? null;
    } catch (err) {
      logger.error(
        `LINE push failed for approval ${request.id}`,
        err instanceof Error ? err : undefined,
      );
      throw err;
    }
  }

  /**
   * Send a confirmation message when an approval is resolved.
   */
  async sendResolutionNotice(request: ApprovalRequest): Promise<void> {
    const statusEmoji = request.status === "approved" ? "\u2705" : // check mark
                        request.status === "denied" ? "\u274c" :   // cross mark
                        "\u23f0";                                  // alarm clock (expired)
    const statusText = request.status.charAt(0).toUpperCase() + request.status.slice(1);

    const message = {
      type: "text" as const,
      text: [
        `${statusEmoji} Approval ${statusText}`,
        ``,
        `Tool: ${request.toolName}`,
        `ID: ${request.id}`,
        request.resolvedBy ? `By: ${request.resolvedBy}` : "",
        request.resolvedAt ? `At: ${request.resolvedAt}` : "",
      ].filter(Boolean).join("\n"),
    };

    const payload = {
      to: this.config.creatorUserId,
      messages: [message],
    };

    try {
      await this.pushMessage(payload);
      logger.info(`LINE resolution notice sent for ${request.id}`);
    } catch (err) {
      logger.error(
        `LINE resolution notice failed for ${request.id}`,
        err instanceof Error ? err : undefined,
      );
      // Don't throw — resolution notices are best-effort
    }
  }

  // ─── Flex Message Builder ───────────────────────────────────

  /**
   * Build a LINE Flex Message for an approval request.
   *
   * Layout:
   *   Header:  "Approval Required" with risk-level color
   *   Body:    Tool name, arguments summary, reason, expiry
   *   Footer:  Approve and Deny buttons (postback actions)
   */
  private buildApprovalFlexMessage(request: ApprovalRequest): LINEFlexMessage {
    const headerColor = this.getRiskColor(request.riskLevel);
    const argsSummary = this.formatArgsSummary(request.toolArgs);
    const expiresFormatted = this.formatExpiry(request.expiresAt);

    return {
      type: "flex",
      altText: `Approval Required: ${request.toolName}`,
      contents: {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: headerColor,
          paddingAll: "16px",
          contents: [
            {
              type: "text",
              text: "\ud83d\udd10 Approval Required",
              color: "#ffffff",
              weight: "bold",
              size: "lg",
            },
            {
              type: "text",
              text: `Risk: ${request.riskLevel.toUpperCase()}`,
              color: "#ffffffcc",
              size: "xs",
              margin: "sm",
            },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          paddingAll: "16px",
          contents: [
            // Tool name
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "Tool",
                  size: "sm",
                  color: "#888888",
                  flex: 2,
                },
                {
                  type: "text",
                  text: request.toolName,
                  size: "sm",
                  weight: "bold",
                  flex: 5,
                  wrap: true,
                },
              ],
            },
            // Arguments
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "Args",
                  size: "sm",
                  color: "#888888",
                  flex: 2,
                },
                {
                  type: "text",
                  text: argsSummary,
                  size: "sm",
                  flex: 5,
                  wrap: true,
                },
              ],
            },
            // Separator
            { type: "separator", margin: "md" },
            // Reason
            {
              type: "text",
              text: request.humanMessage,
              size: "sm",
              color: "#666666",
              wrap: true,
              margin: "md",
            },
            // Request ID and Expiry
            {
              type: "box",
              layout: "vertical",
              margin: "lg",
              spacing: "xs",
              contents: [
                {
                  type: "text",
                  text: `ID: ${request.id.slice(0, 16)}...`,
                  size: "xxs",
                  color: "#aaaaaa",
                },
                {
                  type: "text",
                  text: `Expires: ${expiresFormatted}`,
                  size: "xxs",
                  color: "#aaaaaa",
                },
              ],
            },
          ],
        },
        footer: {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          paddingAll: "16px",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#28a745",
              height: "sm",
              action: {
                type: "postback",
                label: "Approve",
                data: `action=approve&id=${request.id}`,
                displayText: "Approved",
              },
            },
            {
              type: "button",
              style: "primary",
              color: "#dc3545",
              height: "sm",
              action: {
                type: "postback",
                label: "Deny",
                data: `action=deny&id=${request.id}`,
                displayText: "Denied",
              },
            },
          ],
        },
      },
    };
  }

  private getRiskColor(riskLevel: string): string {
    switch (riskLevel) {
      case "forbidden": return "#c0392b"; // dark red
      case "dangerous": return "#e74c3c"; // red
      case "caution":   return "#f39c12"; // orange
      case "safe":      return "#27ae60"; // green
      default:          return "#7f8c8d"; // gray
    }
  }

  private formatArgsSummary(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return "(none)";

    return entries
      .map(([key, value]) => {
        const strValue = typeof value === "string"
          ? (value.length > 40 ? value.slice(0, 37) + "..." : value)
          : JSON.stringify(value);
        return `${key}: ${strValue}`;
      })
      .join("\n");
  }

  private formatExpiry(expiresAt: string): string {
    try {
      const date = new Date(expiresAt);
      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const diffMins = Math.round(diffMs / 60_000);

      if (diffMins <= 0) return "Expired";
      if (diffMins < 60) return `${diffMins} min remaining`;
      const diffHours = Math.round(diffMins / 60);
      return `${diffHours}h remaining`;
    } catch {
      return expiresAt;
    }
  }

  // ─── LINE API Methods ───────────────────────────────────────

  private async pushMessage(payload: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${LINE_API_BASE}/message/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.channelAccessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(
          `LINE API push failed (${res.status}): ${(errBody as any).message || res.statusText}`,
        );
      }

      return await res.json().catch(() => ({}));
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─── Webhook Parsing ────────────────────────────────────────────

/**
 * Result of parsing a LINE webhook postback event.
 */
export interface LINEPostbackAction {
  action: "approve" | "deny";
  requestId: string;
  userId: string;
  replyToken: string;
}

/**
 * Parse LINE webhook events and extract approval postback actions.
 *
 * Only processes postback events whose data contains action=approve or action=deny.
 * Filters to only accept events from the configured creator user ID.
 *
 * @param body Raw LINE webhook body (parsed JSON)
 * @param creatorUserId The allowed user ID for approval actions
 * @returns Array of parsed postback actions
 */
export function parseLINEWebhookEvents(
  body: LINEWebhookBody,
  creatorUserId: string,
): LINEPostbackAction[] {
  const actions: LINEPostbackAction[] = [];

  if (!body?.events || !Array.isArray(body.events)) {
    return actions;
  }

  for (const event of body.events) {
    // Only handle postback events
    if (event.type !== "postback") continue;

    // Only accept from the creator
    const userId = event.source?.userId;
    if (!userId || userId !== creatorUserId) {
      logger.warn(`Ignoring postback from unauthorized user: ${userId}`);
      continue;
    }

    // Parse postback data: "action=approve&id=01ARZ3NDEKTSV..."
    const params = new URLSearchParams(event.postback?.data ?? "");
    const action = params.get("action");
    const requestId = params.get("id");

    if (!action || !requestId) continue;
    if (action !== "approve" && action !== "deny") continue;

    actions.push({
      action,
      requestId,
      userId,
      replyToken: event.replyToken ?? "",
    });
  }

  return actions;
}

/**
 * Send a reply message using a LINE reply token.
 * Reply tokens are single-use and expire after a short window.
 */
export async function replyToLINE(
  replyToken: string,
  text: string,
  channelAccessToken: string,
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${LINE_API_BASE}/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ message: res.statusText }));
      logger.error(
        `LINE reply failed (${res.status}): ${(errBody as any).message || res.statusText}`,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Verify LINE webhook signature using HMAC-SHA256.
 *
 * @param body Raw request body (string or Buffer)
 * @param signature Value of X-Line-Signature header
 * @param channelSecret LINE channel secret
 * @returns true if signature is valid
 */
export function verifyLINESignature(
  body: string | Buffer,
  signature: string,
  channelSecret: string,
): boolean {
  const { createHmac } = require("crypto");
  const digest = createHmac("SHA256", channelSecret)
    .update(body)
    .digest("base64");

  // Use timing-safe comparison to prevent timing attacks
  if (digest.length !== signature.length) return false;

  const { timingSafeEqual } = require("crypto");
  try {
    return timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}

// ─── LINE API Type Stubs ────────────────────────────────────────
// Minimal types for the LINE Messaging API structures we use.

interface LINEWebhookBody {
  destination?: string;
  events: LINEWebhookEvent[];
}

interface LINEWebhookEvent {
  type: string;
  replyToken?: string;
  source?: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  timestamp?: number;
  postback?: {
    data: string;
    params?: Record<string, string>;
  };
  message?: {
    type: string;
    id: string;
    text?: string;
  };
}

// Flex Message types (subset needed for approval cards)
interface LINEFlexMessage {
  type: "flex";
  altText: string;
  contents: FlexBubble;
}

interface FlexBubble {
  type: "bubble";
  size?: string;
  header?: FlexBox;
  body?: FlexBox;
  footer?: FlexBox;
}

interface FlexBox {
  type: "box";
  layout: "horizontal" | "vertical" | "baseline";
  contents: FlexComponent[];
  spacing?: string;
  margin?: string;
  paddingAll?: string;
  backgroundColor?: string;
}

type FlexComponent = FlexBox | FlexText | FlexButton | FlexSeparator;

interface FlexText {
  type: "text";
  text: string;
  size?: string;
  weight?: string;
  color?: string;
  wrap?: boolean;
  flex?: number;
  margin?: string;
}

interface FlexButton {
  type: "button";
  style?: string;
  color?: string;
  height?: string;
  action: FlexAction;
}

interface FlexSeparator {
  type: "separator";
  margin?: string;
}

interface FlexAction {
  type: "postback" | "message" | "uri";
  label: string;
  data?: string;
  text?: string;
  displayText?: string;
  uri?: string;
}
