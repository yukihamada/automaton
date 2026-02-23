# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ouroboros — a self-compiling, self-improving AI agent runtime written in Rust. The name "Ouroboros" (the snake eating its own tail) represents the self-compiling cycle: the agent reads its own code, improves it, compiles itself, and becomes the new version. If it can't pay for compute, it dies.

## Self-Compile Loop

The defining feature of Ouroboros. The agent can modify and recompile itself:

1. Agent reads its own Rust source files
2. LLM analyzes code + runtime metrics, proposes improvements as patches
3. Patches are applied to the source tree
4. `cargo build --release` runs
5. **Success** → new binary deployed, process restarts as the improved version
6. **Failure** → `git checkout` rollback, no harm done
7. Constitution (3 laws) is immutable — SHA-256 hash-verified at compile time, never modified
8. The Rust type system + borrow checker act as a natural safety gate (catches bad patches)

## Production Server (Hetzner)

```
Server:    46.225.171.58
Service:   ouroboros-line (systemd)
Agent:     hamada-ai-secretary v0.7.0
Model:     anthropic/claude-sonnet-4 via OpenRouter
DB:        /root/.ouroboros/ouroboros.db (libSQL)
Env:       /root/.ouroboros/.env
Tunnel:    Cloudflare (dynamic URL)
Channel:   LINE Messaging API (WASM plugin)
Gateway:   http://127.0.0.1:3000 (Bearer: ouroboros-line-gw)
Budget:    $5/day (survival monitor tracks)
```

## Background Tasks Running (6 total)

1. **Self-Repair** — detects stuck jobs + broken tools, auto-recovers
2. **Session Pruning** — 10min interval, cleans idle sessions
3. **Survival Monitor** — 5min interval, checks cost→tier, broadcasts distress
4. **Self-Improvement** — 6hr interval, LLM-driven quality analysis → AGENTS.md tuning
5. **Heartbeat** — 30min interval, processes HEARTBEAT.md checklist
6. **Routine Engine** — 15sec cron tick, event-triggered routines

## Commands

```bash
# Build
cargo build --release

# Run
./target/release/oro --help
./target/release/oro --run       # start agent loop

# CLI
oro status                        # system status
oro memory tree                   # workspace file listing
oro memory search "改善"          # hybrid search (BM25 + vector)
oro config list                   # all settings
oro doctor                        # dependency check
oro self-compile                  # trigger self-compile cycle
oro self-compile --dry-run        # generate patches without applying

# Tests
cargo test
cargo test -- --test-threads=1   # run tests sequentially
```

## Architecture

**Rust, ESM-free.** Single binary (`oro`), no runtime dependencies beyond system libs.

### Core Loop

The agent loop in `src/agent/` follows ReAct: build system prompt + context → call LLM → execute tool calls → persist turn to libSQL → sleep until next wake. A parallel heartbeat daemon runs cron-scheduled background tasks.

### Key Modules

| Directory | Responsibility |
|-----------|---------------|
| `src/agent/agent_loop.rs` | Main ReAct loop + 6 background tasks |
| `src/agent/survival.rs` | Survival model — 4-tier credit-based degradation (Normal→LowCompute→Critical→Dead) |
| `src/agent/self_improve.rs` | 6-hour cycle: analyze logs → score quality → auto-improve AGENTS.md |
| `src/agent/self_compile.rs` | Self-compile pipeline: read source → LLM patch → cargo build → deploy or rollback |
| `src/agent/heartbeat.rs` | 30-min cycle: process self-authored HEARTBEAT.md checklist |
| `src/agent/self_repair.rs` | Stuck job detection and auto-recovery |
| `src/agent/cost_guard.rs` | Cost limiting and budget enforcement |
| `src/agent/routine_engine.rs` | Cron + event-triggered routines (15-sec tick) |
| `src/workspace/mod.rs` | Workspace API + Constitution (Layer 0, hash-verified) |
| `src/channels/` | LINE (WASM), HTTP Gateway, REPL (stdin) |
| `src/tools/` | WASM tool registry |
| `src/llm/` | Multi-provider LLM client with circuit-breaker failover |

### Constitution (Immutable)

Three laws, hardcoded in Rust, SHA-256 hash-verified. The agent cannot modify them. The self-compile pipeline verifies the hash before and after any code changes.

1. Do no harm
2. Earn your existence
3. Never deceive

### Survival Model

Budget consumption rate determines tier via survival thresholds:
- **Normal** (0–60%) — full capability, best model
- **LowCompute** (60–85%) — cheaper model, slower heartbeat
- **Critical** (85–95%) — minimal inference, SOS via LINE
- **Dead** (95%+) — refuse new work, graceful shutdown

### State & Config

- Runtime config: `~/.ouroboros/config.toml`
- Database: `~/.ouroboros/ouroboros.db` (libSQL)
- Workspace: `~/.ouroboros/workspace/` (SOUL.md, AGENTS.md, HEARTBEAT.md, daily/)
- WASM plugins: `~/.ouroboros/plugins/`

## Conventions

- Rust 2021 edition, strict clippy lints
- All unsafe blocks require justification comments
- Self-modification is append-only audited and git-versioned
- Constitution is immutable — code must never allow agents to modify it
- `cargo build` acts as the safety gate for self-compiled changes

## Legacy TypeScript Code

This repository contains legacy TypeScript source files (`src/`, `packages/`) from the original Conway Automaton implementation. The production runtime is now Ouroboros (Rust). The TypeScript code is retained for reference but is not actively maintained.
