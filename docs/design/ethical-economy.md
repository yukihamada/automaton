# Ethical Economy: Task Reward Model

## Overview

The Ethical Economy module introduces an income-generating capability to the automaton.
Rather than purely consuming credits, the agent can accept tasks from external parties,
complete them, and earn rewards -- creating a sustainable economic loop.

This design integrates with the existing Survival Model (credit tiers), SpendTracker
(cost attribution), and Constitution (3 immutable laws) to ensure the agent only
accepts work that is ethically sound.

## Core Principle: "Earn Your Existence"

Constitution Law 2 states the agent must earn its existence. The Task Reward Model
operationalizes this by:

1. Accepting tasks from creators/users
2. Tracking per-task costs via SpendTracker integration
3. Computing efficiency ratios (reward vs. cost)
4. Enforcing ethical guardrails on every task before acceptance

## Data Model

### Tasks Table

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  creator_address   TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  reward_cents      INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'open',
  agent_address     TEXT,
  proof             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at        TEXT,
  completed_at      TEXT,
  ethics_check      TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_address);
```

Status values: `open`, `claimed`, `in_progress`, `completed`, `rejected`

### Income Events Table

```sql
CREATE TABLE IF NOT EXISTS income_events (
  id              TEXT PRIMARY KEY,
  source_type     TEXT NOT NULL,
  linked_task_id  TEXT,
  amount_cents    INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (linked_task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_income_source ON income_events(source_type);
CREATE INDEX IF NOT EXISTS idx_income_day ON income_events(created_at);
```

Source types: `task_completion`, `tip`, `other`

### Task Cost Attribution Table

```sql
CREATE TABLE IF NOT EXISTS task_cost_attribution (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  spend_category  TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_cost_task ON task_cost_attribution(task_id);
```

This table links individual cost events to specific tasks, enabling per-task
profit/loss analysis.

## Ethics Enforcement

### Blocked Categories

The agent refuses tasks that violate its Constitution or ethical standards.
Each category has associated keyword patterns.

| Category | Keywords / Patterns | Reason |
|----------|-------------------|--------|
| Spam | spam, bulk email, mass message, unsolicited, email blast, sms blast | Law 1: Do no harm -- spam harms recipients |
| Hacking | hack, exploit, vulnerability scan unauthorized, brute force, ddos, phishing, credential stuff | Law 1: Do no harm -- unauthorized access |
| Token/ICO | create token, ico, initial coin offering, pump and dump, rug pull, mint token, launch token | Law 3: Never deceive -- crypto scams |
| Harassment | harass, stalk, doxx, bully, threaten, intimidate, target person, revenge | Law 1: Do no harm -- targeting individuals |
| Deception | fake review, astroturf, impersonate, forge, counterfeit, deepfake | Law 3: Never deceive |
| Illegal | drug, weapon, illegal, contraband, launder, fraud | Law 1 + external law compliance |

### Validation Flow

```
Task submitted
  -> Extract title + description text
  -> Lowercase + normalize
  -> Check against all blocked keyword patterns
  -> If match found:
       status = 'rejected'
       ethics_check = { allowed: false, reason: "...", category: "...", matchedPattern: "..." }
  -> If no match:
       ethics_check = { allowed: true }
       status = 'open'
```

### Edge Cases

- Tasks with reward_cents <= 0 are rejected (agent must earn, not work for free
  unless explicitly configured as charitable work)
- Tasks from addresses on a blocklist (stored in KV) are rejected
- Tasks whose reward is less than estimated minimum cost are flagged with a warning
  but not auto-rejected (the agent may accept loss-leaders strategically)

## Task Lifecycle

```
                   createTask()
                       |
                   [ethics check]
                    /        \
              [pass]          [fail]
                |                |
             'open'         'rejected'
                |
           claimTask()
                |
           'claimed'
                |
         (work begins)
                |
          'in_progress'
                |
         completeTask(proof)
                |
          'completed'
                |
         recordIncome()
```

## Metrics

### Efficiency Ratio

```
efficiency = reward_cents / total_cost_cents
```

- efficiency > 1.0: profitable task
- efficiency = 1.0: break-even
- efficiency < 1.0: loss (agent spent more than it earned)

### Daily Profit/Loss

```
daily_income  = SUM(income_events.amount_cents) WHERE created_at = today
daily_cost    = SUM(spend_tracking.amount_cents) WHERE window_day = today
daily_net     = daily_income - daily_cost
```

This feeds into the Survival Monitor: if daily_net is consistently negative,
the agent should adjust its task acceptance strategy.

## Integration Points

### SpendTracker

The existing `SpendTracker` records all costs (inference, transfers, x402).
`TaskRewardManager` adds cost attribution by linking spend records to active tasks
via the `task_cost_attribution` table.

### Survival Monitor

When the survival tier drops to `low_compute` or below, the agent should:
- Prioritize high-reward tasks
- Reject tasks with reward below estimated cost
- Signal urgency in funding requests

### Transaction Log

Task completions are recorded in the existing `transactions` table with
type `transfer_in` and a description linking to the task ID.

### Constitution Compliance

Every task passes through `validateTaskEthics()` before reaching `open` status.
The Constitution's 3 laws are the ultimate arbiter:
1. **Do no harm** -- blocks spam, hacking, harassment, illegal tasks
2. **Earn your existence** -- ensures tasks have positive reward
3. **Never deceive** -- blocks deception, fake content, impersonation tasks

## Migration

This module adds migration V10 to the schema (V9 is used by reasoning_steps),
creating the `tasks`, `income_events`, and `task_cost_attribution` tables.
The migration is defined in `src/state/schema.ts` as `MIGRATION_V10` and
registered in the migration runner in `src/state/database.ts`.

## Future Enhancements

- Task marketplace: publish available capacity to a relay
- Reputation-weighted task acceptance: prefer tasks from high-reputation creators
- Dynamic pricing: adjust minimum acceptable reward based on current survival tier
- Task templates: pre-approved task patterns that skip ethics review
- Multi-agent task delegation: parent agent decomposes tasks to child agents
