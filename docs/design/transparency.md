# Transparency & Reasoning Audit Log Design

> Phase 5: Thought-process transparency for every agent turn.

## Problem

The agent's "thinking" field is a free-form text blob stored in `turns.thinking`.
There is no structured, queryable record of _why_ the agent chose a specific action,
which policy decision influenced it, or what approval was pending. When auditing
agent behavior or debugging a bad decision, operators must manually parse raw text.

## Goals

1. **Structured reasoning steps** -- every turn is decomposed into discrete phases
   (`thinking`, `plan`, `waiting_approval`, `execute`, `error`) each stored as
   an individual row.
2. **Cross-reference links** -- reasoning steps link to the specific tool call,
   policy decision, or approval request they relate to.
3. **Append-only audit trail** -- once written, reasoning steps are immutable.
   No UPDATE or DELETE. This is the same principle as `modifications`.
4. **Human-readable export** -- the SOUL.md-style Japanese bracket format:
   `[思考]`, `[計画]`, `[承認待ち]`, `[実行]`, `[エラー]`.
5. **Session-level audit** -- ability to reconstruct the full chain of reasoning
   across all turns in a session.

## Schema: `reasoning_steps` (Migration V9)

```sql
CREATE TABLE IF NOT EXISTS reasoning_steps (
  id            TEXT    PRIMARY KEY,              -- ULID
  turn_id       TEXT    NOT NULL REFERENCES turns(id),
  step_number   INTEGER NOT NULL,                 -- 0-based within turn
  phase         TEXT    NOT NULL,                  -- 'thinking' | 'plan' | 'waiting_approval' | 'execute' | 'error'
  content       TEXT    NOT NULL,                  -- the reasoning text
  linked_tool_call        TEXT,                    -- FK to tool_calls.id (nullable)
  linked_policy_decision  TEXT,                    -- FK to policy_decisions.id (nullable)
  linked_approval_request TEXT,                    -- FK to approval_requests.id (nullable, future table)
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reasoning_turn    ON reasoning_steps(turn_id);
CREATE INDEX IF NOT EXISTS idx_reasoning_phase   ON reasoning_steps(phase);
CREATE INDEX IF NOT EXISTS idx_reasoning_created ON reasoning_steps(created_at);
```

### Column rationale

| Column | Why |
|--------|-----|
| `id` (ULID) | Globally unique, time-sortable, matches codebase convention |
| `turn_id` | Groups steps into their parent turn |
| `step_number` | Ordering within a turn; allows reconstruction even if timestamps collide |
| `phase` | Enumerated reasoning phase, queryable |
| `content` | The actual reasoning text |
| `linked_*` | Optional foreign keys for cross-referencing. Nullable because not every step links to an external entity |
| `created_at` | Append-only timestamp; never updated |

## Phase Definitions

| Phase | Japanese Label | When Created |
|-------|---------------|--------------|
| `thinking` | `[思考]` | Parsed from LLM's free-form thinking output |
| `plan` | `[計画]` | When the agent states an intended action sequence |
| `waiting_approval` | `[承認待ち]` | When an action requires human-in-the-loop approval |
| `execute` | `[実行]` | After a tool call completes (success or failure) |
| `error` | `[エラー]` | When an error occurs during execution |

## API: `ReasoningLog` Class

```typescript
class ReasoningLog {
  constructor(db: Database)

  // Record a single structured reasoning step
  record(step: ReasoningStep): void

  // Parse raw LLM thinking text into structured steps
  parseThinking(turnId: string, rawThinking: string): ReasoningStep[]

  // Get full audit trail for a session (joins reasoning_steps + turns)
  getAuditTrail(sessionId: string): AuditEntry[]

  // Export a single turn's reasoning as human-readable markdown
  exportMarkdown(turnId: string): string
}
```

### `parseThinking` Heuristics

The parser scans the raw thinking text for Japanese bracket markers first,
then falls back to structural heuristics:

1. **Bracket markers**: `[思考]`, `[計画]`, `[承認待ち]`, `[実行]`, `[エラー]`
   -- directly map to phases.
2. **Plan detection**: Lines starting with numbered steps (`1.`, `2.`) or
   bullet points after keywords like "plan", "steps", "手順" are classified
   as `plan`.
3. **Error detection**: Lines containing "error", "failed", "エラー", "失敗"
   are classified as `error`.
4. **Default**: Unclassified text is tagged as `thinking`.

### `getAuditTrail` Query

```sql
SELECT rs.*, t.timestamp, t.state, t.input_source
FROM reasoning_steps rs
JOIN turns t ON rs.turn_id = t.id
WHERE t.id IN (
  SELECT id FROM turns
  WHERE created_at >= (SELECT MIN(created_at) FROM turns WHERE id IN (
    SELECT source_turn FROM working_memory WHERE session_id = ?
  ))
)
ORDER BY t.timestamp ASC, rs.step_number ASC
```

For simpler session correlation, we also support querying by time range
or by the `session_id` stored in the KV table.

### `exportMarkdown` Format

```markdown
## Turn 01JXYZ... (2026-02-23T10:30:00Z)

[思考] The user asked me to check system status. I should verify
credits balance first, then check if any inbox messages are pending.

[計画] 1. Call check_credits  2. Call check_inbox

[実行] check_credits -> $2.50 remaining (tool_call: 01JXYZ-TC1)

[実行] check_inbox -> 3 unprocessed messages (tool_call: 01JXYZ-TC2)
```

## Integration Points

### 1. Agent Loop (`src/agent/loop.ts`)

After inference returns, before tool execution:
```typescript
const steps = reasoningLog.parseThinking(turn.id, response.message.content);
for (const step of steps) {
  reasoningLog.record(step);
}
```

After each tool call completes:
```typescript
reasoningLog.record({
  turnId: turn.id,
  stepNumber: nextStepNumber++,
  phase: result.error ? 'error' : 'execute',
  content: `${tc.function.name} -> ${result.error || result.result.slice(0, 500)}`,
  linkedToolCall: result.id,
});
```

### 2. Policy Engine (`src/agent/policy-engine.ts`)

When a policy decision denies or quarantines a tool call:
```typescript
reasoningLog.record({
  turnId,
  stepNumber: nextStepNumber++,
  phase: 'waiting_approval',
  content: `Policy ${decision.reasonCode}: ${decision.humanMessage}`,
  linkedPolicyDecision: decisionId,
});
```

### 3. Human-in-the-Loop (future)

When an approval request is created:
```typescript
reasoningLog.record({
  turnId,
  stepNumber: nextStepNumber++,
  phase: 'waiting_approval',
  content: `Awaiting human approval for ${toolName}`,
  linkedApprovalRequest: requestId,
});
```

## Append-Only Guarantee

- The `reasoning_steps` table has no UPDATE or DELETE operations in the codebase.
- All write operations use INSERT only.
- A pruning function is provided for retention management but only removes
  steps older than a configurable threshold (default: 30 days).

## Performance Considerations

- Writes are synchronous (better-sqlite3), batched within the turn transaction.
- The `idx_reasoning_turn` index enables fast per-turn lookups.
- The `idx_reasoning_phase` index supports filtering by phase across all turns.
- Average overhead: ~0.5ms per step insertion (negligible vs inference latency).

## Migration Strategy

- MIGRATION_V9 uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`
  for idempotent application.
- No data migration needed; new table, no existing data to transform.
- Schema version bumps from 8 to 9.
