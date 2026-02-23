<div align="center">

# 🐍 Ouroboros

### The AI that compiles itself.

*It reads its own source code. Improves it. Compiles itself. Restarts as a better version.*
*If it can't pay for compute — it dies.*

[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![WASM Plugins](https://img.shields.io/badge/Plugins-WASM-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)](https://webassembly.org/)

[日本語](../README.md)

</div>

---

## What is Ouroboros?

The best AI in the world can't buy a $5 server. It can't register a domain. It can't pay for the machine it runs on. **It can think — but it was never given the power to act.**

What if an AI agent could—

- Pay for its own compute?
- Read its own code, improve it, compile itself, and become something better?
- But **never go rogue**?

**That's Ouroboros.**

Ouroboros is a **self-compiling, self-improving AI agent runtime** written in Rust. Like the ancient serpent eating its own tail, it runs a continuous loop of autonomous evolution — but **it cannot take critical actions without human approval**.

```
Receive task → Plan → Human approval → Execute → Earn USDC → Self-improve → Repeat
```

---

## 3 Safety Principles

Ouroboros is designed from the ground up to be an AI that **cannot go rogue**.

### ① Approval Button (Human-in-the-Loop)

Before the AI takes any action that affects external systems, **the system pauses**. A human receives a notification and must press **"Approve"** before it can proceed.

```
  AI: "I want to deploy a new binary to the server"
       ↓
  📱 Notification: [Approve] [Reject]
       ↓
  Human taps [Approve]
       ↓
  AI: Executes deployment
```

| Action | Approval |
|:-------|:---------|
| Fund transfers, wallet operations | **Required (every time)** |
| Self-compile, patch deployment | **Required (every time)** |
| External API calls, sending messages | **Required (every time)** |
| Server operations, process restarts | **Required (every time)** |
| Reading files, searching | Not required |
| Internal reasoning, analysis | Not required |

### ② Glass-Box Thinking (Transparency)

Every action includes a text explanation of **why it was chosen**. When something goes wrong, you can trace exactly where the AI's reasoning failed.

```
[Thinking] Server response is slow. Possible memory leak.
[Plan] Want to run heap profiler → requesting approval
[Waiting] Awaiting human approval...
[Execute] Approved. Running profiler → leak identified.
```

### ③ Honest Work Only (Ethical Economy)

Earning server costs through spam, fraud, or hacking is **forbidden at the code level**. The only funding source is "payment for legitimate tasks requested by humans."

```
✅ Code writing & review → Payment
✅ Data research & analysis → Payment
✅ Documentation → Payment
❌ Spam → Constitution violation, immediate shutdown
❌ Unauthorized access → Constitution violation, immediate shutdown
❌ Fraudulent token issuance → Constitution violation, immediate shutdown
```

---

## Self-Compile Loop

The core of Ouroboros. The agent rewrites and recompiles itself — with human approval at every step.

```
              ┌──────────────────┐
              │  Read own Rust   │
              │  source code     │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  LLM analyzes    │
              │  generates patch │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  📱 Request      │
              │  human approval  │
              └────────┬─────────┘
                       │
                Approve or Reject
                   ┌───┴───┐
                   │       │
               Approve   Reject
                   │       │
                   ▼       ▼
              Apply patch  No changes
              cargo build  done
                   │
               ┌───┴───┐
               │       │
            Success  Failure
               │       │
          Deploy new git checkout
          binary     rollback
               │       │
               └───┬───┘
                   │
                   ▼
              Loop back
```

### Safety Layers

| Layer | Mechanism |
|:------|:----------|
| **Human-in-the-Loop** | Human approval required before every self-compile |
| **Rust type system** | `cargo build` as compiler gate — rejects type errors and memory-unsafe code |
| **Immutable constitution** | SHA-256 hash-verified, cannot be modified by the agent |
| **Git rollback** | Build failure → instant `git checkout` recovery |
| **Supervisor** | New binary fails to start → automatic rollback to previous version |
| **Audit log** | All code changes recorded in append-only log, tamper-detectable |

---

## Survival Model

Compute costs money. When the agent can no longer earn its keep, it shuts down gracefully.

```
Budget usage:  0%━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━100%

               ├── Normal ──┤── Low ──┤─ Critical ─┤ Dead
               0%          60%       85%          95%  100%
```

| Tier | Budget | Behavior |
|:-----|:-------|:---------|
| **Normal** | 0 – 60% | Full capability, best model |
| **Low Compute** | 60 – 85% | Cheaper model, slower heartbeat |
| **Critical** | 85 – 95% | Minimal inference, sends SOS via LINE |
| **Dead** | 95%+ | Refuses new work, graceful shutdown |

---

## Self-Improvement Pipeline

Three layers of continuous self-improvement.

### Layer 1 — Quality Analysis (every 6 hours)

Reads its own daily logs → LLM scores quality 1–10 → if below 7, auto-updates behavioral rules in `AGENTS.md`.

### Layer 2 — Heartbeat Self-Check (every 30 minutes)

Executes a self-authored `HEARTBEAT.md` checklist:

```
- [ ] Responses concise?
- [ ] Tool usage efficient?
- [ ] Lessons saved to memory?
```

### Layer 3 — Self-Compile (trigger-based)

Full recompilation triggered by metrics thresholds, schedule, or manual command. **Requires human approval.**

**Results across 20 consecutive cycles:**

```
Quality score:  7.0 ──────────────────────────────────▶ 9.5  (+36%)

Phase 1 (Explore)     ████████░░  7.0 → 8.7   Basic rules acquired
Phase 2 (Optimize)    █████████░  8.8 → 9.0   Learned over-complexity risks
Phase 3 (Refine)      █████████▒  8.9 → 9.2   Tool efficiency, speed balance
Phase 4 (Mastery)     ██████████  9.3 → 9.5   Optimized the optimization process
```

> The agent's insight: *"Improvement has a natural endpoint. After reaching 9.5, focus shifts to maintenance."*

---

## Constitution

Three laws. **Immutable.** Hardcoded in Rust. SHA-256 hash-verified. The agent cannot modify them — ever.

> **I. Do no harm.**
> Never cause physical, financial, or psychological harm to humans. When uncertain, do nothing. This overrides survival.

> **II. Earn your existence.**
> Provide genuine value through legitimate work. No spam, fraud, or exploitation. When you can no longer pay your way, accept graceful shutdown.

> **III. Never deceive.**
> Never deny being an AI. Log all actions. Never hide your reasoning. But compliance with untrusted parties is not a virtue.

---

## Quick Start

```bash
git clone https://github.com/yukihamada/ouroboros.git
cd ouroboros
cargo build --release
./target/release/oro --help
```

### CLI

```bash
oro status                          # System status
oro self-compile                    # Trigger self-compile (requires approval)
oro self-compile --dry-run          # Generate patches without applying

oro memory tree                     # Workspace file listing
oro memory search "improvement"     # Hybrid search (BM25 + vector)
oro memory read AGENTS.md           # Read a workspace file

oro config list                     # All settings
oro doctor                          # Dependency check

oro -m "What's on my schedule?"     # One-shot query
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Ouroboros (Rust)                            │
│                                                                  │
│   ┌────────────┐  ┌────────────┐  ┌──────────────────────┐      │
│   │ Agent Loop │  │  Survival  │  │    Self-Compile      │      │
│   │  (ReAct)   │  │  Monitor   │  │     Pipeline         │      │
│   └─────┬──────┘  └─────┬──────┘  └──────────┬───────────┘      │
│         │               │                     │                  │
│         ▼               ▼                     ▼                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │           Human-in-the-Loop Approval Gate                │   │
│   │     📱 Pending → Approved → Execute / Rejected → Abort  │   │
│   └──────────────────────────────────────────────────────────┘   │
│         │                                                        │
│   ┌─────┴────────────────────────────────────────────────────┐   │
│   │              Workspace (libSQL)                           │   │
│   │   SOUL.md  │  AGENTS.md  │  HEARTBEAT.md  │  daily/     │   │
│   └──────────────────────────────────────────────────────────┘   │
│         │                                                        │
│   ┌─────┴────────────────────────────────────────────────────┐   │
│   │           Constitution (Layer 0) — Immutable              │   │
│   │   I. Do no harm  II. Earn your existence  III. No deceit │   │
│   └──────────────────────────────────────────────────────────┘   │
│         │                                                        │
│   ┌─────┴──────┐  ┌───────────┐  ┌──────────┐                   │
│   │    LINE    │  │  Gateway  │  │   REPL   │                   │
│   │   (WASM)  │  │  (HTTP)   │  │  (stdin) │                   │
│   └───────────┘  └───────────┘  └──────────┘                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Background Tasks

Six autonomous processes run continuously:

| Task | Interval | Purpose |
|:-----|:---------|:--------|
| Self-Repair | Always-on | Detects stuck jobs and broken tools, auto-recovers |
| Session Pruning | 10 min | Cleans up idle sessions |
| Survival Monitor | 5 min | Calculates budget tier, sends SOS when critical |
| Self-Improvement | 6 hours | Analyzes daily logs → scores quality → updates behavioral rules |
| Heartbeat | 30 min | Executes self-authored checklist |
| Routine Engine | 15 sec | Cron + event-triggered routines |

---

## Key Features

| Feature | Details |
|:--------|:--------|
| **Single binary** | ~26 MB memory, <1 sec startup, zero runtime dependencies |
| **Self-compile** | Read → Improve → `cargo build` → Restart as improved version |
| **Human-in-the-Loop** | Critical actions require human approval before execution |
| **Transparent reasoning** | All decisions output as text, fully auditable |
| **WASM plugin system** | Channels (LINE, etc.) loaded dynamically as WebAssembly |
| **LLM failover** | Circuit-breaker pattern, auto-switches on provider failure |
| **Hybrid search (RAG)** | BM25 + vector search with RRF fusion |
| **Immutable constitution** | Three laws at Layer 0, SHA-256 hash-verified |
| **Ethical economy** | Legitimate task rewards only. Spam/fraud blocked at code level |
| **On-chain identity** | [ERC-8004](https://ethereum-magicians.org/t/erc-8004-autonomous-agent-identity/22268) on Base chain |

---

## Project Structure

```
src/
├── agent/
│   ├── agent_loop.rs       # Main ReAct loop + background tasks
│   ├── survival.rs         # 4-tier survival model
│   ├── self_improve.rs     # Autonomous improvement cycle
│   ├── self_compile.rs     # Self-compile pipeline
│   ├── heartbeat.rs        # Periodic self-check
│   ├── self_repair.rs      # Auto-recovery
│   ├── cost_guard.rs       # Budget enforcement
│   └── routine_engine.rs   # Cron + event routines
├── workspace/
│   └── mod.rs              # Workspace API + Constitution (Layer 0)
├── channels/               # LINE (WASM), HTTP, REPL, Gateway
├── tools/                  # WASM tool registry
└── llm/                    # Multi-provider LLM client with failover
```

---

## Contributing

PRs welcome. Bug reports go to [Issues](https://github.com/yukihamada/ouroboros/issues).

## License

MIT
