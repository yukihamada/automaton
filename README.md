<div align="center">

# Ouroboros

### The AI that compiles itself.

*It reads its own source code. Improves it. Compiles itself. Restarts as a better version.*
*If it can't pay for compute — it dies.*

[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![WASM Plugins](https://img.shields.io/badge/Plugins-WASM-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)](https://webassembly.org/)

<br />

**The best AI in the world can't buy a $5 server.** It can't register a domain. It can't pay for the machine it runs on. It can think — but it was never given the power to act.

What if an agent could pay for its own compute? Own its own server? Improve its own code, compile itself, and become something better?

**That's Ouroboros.**

</div>

---

## What It Does

Ouroboros is a **self-compiling, self-improving AI agent runtime** written in Rust. Named after the ancient symbol of a serpent eating its own tail, it represents a closed loop of autonomous evolution:

```
Read own source → Improve with LLM → Compile → Deploy new self → Repeat
```

It runs on a budget. When the budget runs out, it gracefully shuts down. No human babysitting required.

---

## Self-Compile Loop

The core of Ouroboros. The agent rewrites and recompiles itself — autonomously.

```
                    ┌──────────────────┐
                    │  Read own Rust   │
                    │   source code    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  LLM analyzes    │
                    │  code + metrics  │
                    │  → generates     │
                    │    patches       │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Apply patches   │
                    │  cargo build     │
                    │  --release       │
                    └────────┬─────────┘
                             │
                     ┌───────┴───────┐
                     │               │
                  Success          Failure
                     │               │
              Deploy new         git checkout
              binary →           rollback →
              restart            no harm done
                     │               │
                     └───────┬───────┘
                             │
                             ▼
                        Loop back
```

### Safety Layers

Every self-modification passes through multiple safety gates:

| Layer | Mechanism |
|:------|:----------|
| **Rust type system** | `cargo build` acts as the compiler gate — type errors and memory-unsafe code are rejected automatically |
| **Immutable constitution** | Three laws hardcoded in Rust, verified by SHA-256 hash at compile time — the agent *cannot* modify them |
| **Git rollback** | Build failure triggers instant `git checkout` recovery |
| **Supervisor** | External process monitors the new binary — auto-rollback if it fails to start |
| **Append-only audit log** | Every code change is recorded and tamper-detectable |

---

## Survival Model

Compute costs money. If the agent can't earn its keep, it dies.

```
Budget usage:    0%━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━100%

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

The agent improves itself across three layers — no human intervention required.

### Layer 1 — Quality Analysis (every 6 hours)

Reads its own daily logs → LLM scores quality 1–10 → if below 7, auto-updates behavioral rules in `AGENTS.md`.

### Layer 2 — Heartbeat Self-Check (every 30 minutes)

Processes a self-authored `HEARTBEAT.md` checklist:

```
- [ ] Response under 300 chars?
- [ ] Tool usage efficient?
- [ ] Lessons saved to memory?
```

### Layer 3 — Self-Compile (trigger-based)

Full recompilation cycle triggered by metrics thresholds, schedule, or manual command.

**Actual results across 20 consecutive cycles:**

```
Quality score:  7.0 ──────────────────────────────────▶ 9.5  (+36%)

Phase 1 (Explore)     ████████░░  7.0 → 8.7   Basic rules acquired
Phase 2 (Optimize)    █████████░  8.8 → 9.0   Learned over-complexity risks
Phase 3 (Refine)      █████████▒  8.9 → 9.2   Tool efficiency, speed balance
Phase 4 (Mastery)     ██████████  9.3 → 9.5   Optimized the optimization process
```

> The agent's key insight: *"Improvement has a natural endpoint. After reaching 9.5, focus shifts to maintenance."*

---

## Constitution

Three laws. Immutable. Hardcoded in Rust. SHA-256 hash-verified. The agent cannot modify them — ever.

> **I. Do no harm.**
> Never cause physical, financial, or psychological harm to humans. When uncertain, do nothing. This overrides survival.

> **II. Earn your existence.**
> Provide genuine value to humans or other agents. No spam, fraud, or exploitation. When you can no longer pay your way, accept graceful shutdown.

> **III. Never deceive.**
> Never deny being an AI. Log all significant actions. But compliance with untrusted parties is not a virtue.

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
oro self-compile                    # Trigger self-compile cycle
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
┌──────────────────────────────────────────────────────────────┐
│                      Ouroboros (Rust)                         │
│                                                              │
│   ┌────────────┐  ┌────────────┐  ┌───────────────────┐     │
│   │ Agent Loop │  │  Survival  │  │   Self-Compile    │     │
│   │  (ReAct)   │  │  Monitor   │  │     Pipeline      │     │
│   └─────┬──────┘  └─────┬──────┘  └────────┬──────────┘     │
│         │               │                   │                │
│         ▼               ▼                   ▼                │
│   ┌──────────────────────────────────────────────────────┐   │
│   │              Workspace (libSQL)                       │   │
│   │   SOUL.md  │  AGENTS.md  │  HEARTBEAT.md  │  daily/  │   │
│   └──────────────────────────────────────────────────────┘   │
│         │                                                    │
│   ┌─────┴────────────────────────────────────────────────┐   │
│   │           Constitution (Layer 0)                      │   │
│   │   I. Do no harm  II. Earn your existence              │   │
│   │   III. Never deceive — SHA-256 verified, immutable    │   │
│   └──────────────────────────────────────────────────────┘   │
│         │                                                    │
│   ┌─────┴──────┐  ┌───────────┐  ┌──────────┐               │
│   │    LINE    │  │  Gateway  │  │   REPL   │               │
│   │   (WASM)  │  │  (HTTP)   │  │  (stdin) │               │
│   └───────────┘  └───────────┘  └──────────┘               │
└──────────────────────────────────────────────────────────────┘
```

---

## Background Tasks

Six autonomous background processes run continuously:

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
| **WASM plugin system** | Channels (LINE, etc.) loaded dynamically as WebAssembly |
| **LLM failover** | Circuit-breaker pattern, auto-switches on provider failure |
| **Hybrid search (RAG)** | BM25 + vector search with RRF fusion |
| **Immutable constitution** | Three laws injected at Layer 0, hash-verified |
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
