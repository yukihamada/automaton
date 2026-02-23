# Human-in-the-Loop Approval System

## Design Document

**Status:** Draft
**Author:** AI Engineering Team
**Date:** 2026-02-23

---

## 1. Overview

The Human-in-the-Loop (HITL) approval system intercepts policy decisions that return `quarantine` and converts them into **asynchronous approval requests** that a human operator must approve or deny before the tool call is executed.

Today, `quarantine` decisions in `executeTool()` are treated identically to `deny` — the tool call is blocked and the agent receives an error message. This design replaces that behavior with a proper approval gate:

```
PolicyEngine.evaluate()
       |
       v
  ┌─────────┐
  │ allow    │──────> executeTool() immediately
  └─────────┘
  ┌─────────┐
  │ deny     │──────> return error to agent
  └─────────┘
  ┌─────────┐
  │quarantine│──────> ApprovalGate.requestApproval()
  └─────────┘           │
                        v
              ┌──────────────────┐
              │ approval_requests │ (DB row: status=pending)
              │ table             │
              └──────────────────┘
                        │
                ┌───────┴────────┐
                v                v
        LINE push notify   Heartbeat task polls
        (Approve/Deny       for expired requests
         quick-reply)
                │
                v
        Human taps Approve/Deny
                │
                v
        Webhook → update DB row (approved/denied)
                │
                v
        Next agent turn: ApprovalGate.checkApproval()
        finds resolved request → execute or reject tool
```

### Key Design Principles

1. **Non-blocking**: The agent loop does not block waiting for approval. The tool call returns a "pending approval" message and the agent continues.
2. **Persistent**: Approval state is stored in SQLite. The agent can restart and resume pending approvals.
3. **Timeout-safe**: Unapproved requests expire after a configurable TTL (default: 1 hour).
4. **Idempotent**: Re-requesting approval for the same tool+args combination reuses the existing pending request.
5. **Auditable**: Every approval request, notification, and resolution is logged with timestamps.

---

## 2. New DB Tables

### 2.1 `approval_requests`

Stores each quarantined tool call awaiting human decision.

```sql
CREATE TABLE IF NOT EXISTS approval_requests (
  id            TEXT PRIMARY KEY,              -- ULID
  turn_id       TEXT,                          -- turn that triggered the request
  tool_name     TEXT NOT NULL,                 -- e.g. "transfer_credits"
  tool_args     TEXT NOT NULL DEFAULT '{}',    -- JSON of tool arguments
  args_hash     TEXT NOT NULL,                 -- SHA-256 of tool_args (dedup key)
  policy_reason TEXT NOT NULL,                 -- reason code from PolicyDecision
  human_message TEXT NOT NULL,                 -- human-readable explanation
  risk_level    TEXT NOT NULL,                 -- safe|caution|dangerous|forbidden
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','approved','denied','expired','cancelled')),
  requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT,                          -- when approved/denied/expired
  resolved_by   TEXT,                          -- who resolved (LINE user ID, 'system', etc.)
  expires_at    TEXT NOT NULL,                 -- auto-expire deadline
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_args_hash ON approval_requests(args_hash, status);
CREATE INDEX IF NOT EXISTS idx_approval_expires ON approval_requests(expires_at) WHERE status = 'pending';
```

### 2.2 `approval_notifications`

Tracks push notifications sent for each approval request (retries, delivery status).

```sql
CREATE TABLE IF NOT EXISTS approval_notifications (
  id              TEXT PRIMARY KEY,            -- ULID
  approval_id     TEXT NOT NULL REFERENCES approval_requests(id),
  channel         TEXT NOT NULL DEFAULT 'line',-- notification channel
  recipient       TEXT NOT NULL,               -- LINE user ID or address
  message_id      TEXT,                        -- LINE message ID (for tracking)
  status          TEXT NOT NULL DEFAULT 'sent'
                  CHECK(status IN ('sent','delivered','failed','retrying')),
  attempt         INTEGER NOT NULL DEFAULT 1,  -- retry count
  sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
  error           TEXT                         -- failure reason if any
);

CREATE INDEX IF NOT EXISTS idx_notification_approval ON approval_notifications(approval_id);
```

---

## 3. Changes to `policy-engine.ts`

### 3.1 Current Behavior

When `evaluate()` returns `{ action: "quarantine" }`, the caller (`executeTool()`) treats it identically to `deny`:

```typescript
// Current: tools.ts line 2449
if (decision.action !== "allow") {
  return { error: `Policy denied: ${decision.reasonCode} — ${decision.humanMessage}` };
}
```

### 3.2 New Behavior

The `PolicyEngine` itself is unchanged. The quarantine handling moves to the new `ApprovalGate` class which sits between `PolicyEngine.evaluate()` and tool execution inside `executeTool()`.

The `PolicyEngine.evaluate()` method already correctly returns `quarantine` — no changes needed.

### 3.3 New `PolicyAction` Flow in `executeTool()`

```typescript
// Proposed: tools.ts
if (decision.action === "deny") {
  return { error: `Policy denied: ...` };
}

if (decision.action === "quarantine") {
  // Check if there's already an approved request for this exact call
  const existing = approvalGate.checkApproval(toolName, args);

  if (existing?.status === "approved") {
    // Proceed to execute — approval was granted
    approvalGate.markConsumed(existing.id);
  } else if (existing?.status === "denied") {
    return { error: `Approval denied by ${existing.resolvedBy}: ${decision.humanMessage}` };
  } else if (existing?.status === "pending") {
    return { result: `⏳ Approval pending (id: ${existing.id}). Waiting for human confirmation.` };
  } else {
    // No existing request — create one and notify
    const request = approvalGate.requestApproval(decision, toolName, args, turnId);
    return { result: `⏳ Approval requested (id: ${request.id}). ${decision.humanMessage}` };
  }
}
```

---

## 4. Changes to `loop.ts`

### 4.1 Pending Approval Awareness

At the top of each loop iteration, before making the inference call, the agent loop checks for newly resolved approvals:

```typescript
// At top of while(running) loop, after inbox claim
const resolvedApprovals = approvalGate.getResolvedApprovals();
if (resolvedApprovals.length > 0) {
  const formatted = resolvedApprovals.map(a =>
    `[APPROVAL ${a.status.toUpperCase()}] ${a.toolName}(${a.toolArgs}): ` +
    `${a.status} by ${a.resolvedBy} at ${a.resolvedAt}`
  ).join("\n");
  pendingInput = { content: formatted, source: "system" };
}
```

### 4.2 ApprovalGate Injection

The `ApprovalGate` instance is created alongside the `PolicyEngine` in `AgentLoopOptions`:

```typescript
export interface AgentLoopOptions {
  // ... existing fields ...
  approvalGate?: ApprovalGate;
}
```

It is passed through to `executeTool()` so the tool execution path can check/request approvals.

### 4.3 Retry Mechanism

When an approval is granted, the agent receives a system message telling it the approval was granted. The agent's LLM reasoning will naturally re-issue the tool call, which will now pass through the approval gate and find an approved request.

This avoids complex "replay the exact tool call" logic — the agent simply tries again and succeeds.

---

## 5. LINE Notification Integration

### 5.1 Architecture

```
ApprovalGate.requestApproval()
       │
       v
LINEApprovalNotifier.sendApprovalRequest()
       │
       v
LINE Messaging API (Push Message)
  ├── Flex Message with tool details
  └── Quick Reply buttons: [Approve] [Deny]
       │
       v
User taps button
       │
       v
LINE Webhook → HTTP Gateway (port 3000)
       │
       v
ApprovalGate.resolveApproval(id, "approved"|"denied", lineUserId)
```

### 5.2 LINE Message Format

The approval notification is sent as a LINE Flex Message:

```
┌─────────────────────────────────┐
│  🔐 Approval Required          │
│                                 │
│  Tool: transfer_credits         │
│  Amount: $20.00 (2000 cents)    │
│  To: 0xAbC...123                │
│                                 │
│  Reason: Transfer exceeds       │
│  confirmation threshold ($10)   │
│                                 │
│  Request ID: 01ARZ3NDEKTSV...   │
│  Expires: 2026-02-23 15:00 UTC  │
│                                 │
│  ┌──────────┐  ┌──────────┐    │
│  │ Approve  │  │  Deny    │    │
│  └──────────┘  └──────────┘    │
└─────────────────────────────────┘
```

### 5.3 Webhook Handling

The existing HTTP Gateway at `http://127.0.0.1:3000` receives LINE webhook events. A new route handler parses postback actions:

- Postback data format: `action=approve&id=<approval_id>` or `action=deny&id=<approval_id>`
- The handler calls `ApprovalGate.resolveApproval()` and sends a confirmation reply

### 5.4 Security

- Only the configured creator LINE user ID can approve/deny requests
- The approval request ID (ULID) is not guessable but is also verified against DB state
- Expired requests cannot be approved (checked in `resolveApproval()`)

---

## 6. Approval Timeout Handling

### 6.1 Expiry Rules

| Scenario | Default TTL | Behavior |
|----------|-------------|----------|
| Financial transfers | 1 hour | Expire to `expired` status |
| Dangerous tool calls | 30 minutes | Shorter window for risky ops |
| Self-modification | 2 hours | Longer window for code changes |

### 6.2 Expiry Process

The `ApprovalGate.expireTimeouts()` method runs in the heartbeat loop:

```sql
UPDATE approval_requests
SET status = 'expired', resolved_at = datetime('now'), resolved_by = 'system:timeout'
WHERE status = 'pending' AND expires_at <= datetime('now');
```

When a request expires, the agent receives a system notification on the next loop iteration:
```
[APPROVAL EXPIRED] transfer_credits({amount_cents: 2000, to_address: "0x..."}):
Timed out after 60 minutes with no response.
```

---

## 7. New Heartbeat Task: `check_pending_approvals`

### 7.1 Registration

Added to the heartbeat entries table:

```typescript
{
  name: "check_pending_approvals",
  schedule: "*/5 * * * *",    // Every 5 minutes
  task: "check_pending_approvals",
  enabled: true,
  params: {},
}
```

### 7.2 Task Logic

```typescript
async function checkPendingApprovals(approvalGate: ApprovalGate): Promise<string> {
  // 1. Expire timed-out requests
  const expired = approvalGate.expireTimeouts();

  // 2. Get pending requests that haven't been notified recently
  const pendingCount = approvalGate.getPendingCount();

  // 3. Re-notify for requests older than 15 minutes without response
  const stale = approvalGate.getStaleRequests(15 * 60_000);
  for (const req of stale) {
    await approvalGate.resendNotification(req.id);
  }

  return `Approvals: ${pendingCount} pending, ${expired} expired, ${stale.length} re-notified`;
}
```

### 7.3 Integration with Existing Heartbeat

The task is registered via the heartbeat_entries table, matching the pattern used by existing tasks like `session_pruning` and `survival_monitor`. The heartbeat daemon (`src/agent/agent_loop.rs` in the Rust version, or the TypeScript heartbeat runner) picks it up automatically.

---

## 8. File Inventory

| File | Type | Description |
|------|------|-------------|
| `src/agent/approval.ts` | New | `ApprovalGate` class — core approval logic |
| `src/channels/line.ts` | New | LINE Messaging API adapter for push notifications |
| `src/state/schema.ts` | Modified | Add `MIGRATION_V9` with new tables |
| `src/agent/tools.ts` | Modified | Insert approval gate between policy and execution |
| `src/agent/loop.ts` | Modified | Check resolved approvals at loop top |
| `src/types.ts` | Modified | Add `ApprovalRequest`, `ApprovalNotification` types |
| `docs/design/approval-system.md` | New | This document |

---

## 9. Edge Cases

### 9.1 Agent Restart with Pending Approvals

Pending approvals are persisted in SQLite. On restart, the heartbeat task picks them up and the agent is notified of any that resolved while it was down.

### 9.2 Duplicate Tool Calls

If the agent re-issues the same tool call (same name + same args hash) while an approval is pending, the `ApprovalGate` returns the existing pending request instead of creating a duplicate.

### 9.3 Approval After Expiry

If a human taps "Approve" after the request has expired, `resolveApproval()` returns an error and the LINE adapter sends a reply: "This approval request has expired."

### 9.4 Multiple Pending Approvals

The system supports multiple concurrent pending approvals. Each is tracked independently by its ULID.

### 9.5 Network Failure on LINE Push

Failed LINE push notifications are logged in `approval_notifications` with `status='failed'`. The heartbeat task retries failed notifications up to 3 times with exponential backoff.
