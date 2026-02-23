# Automaton — 自律進化する AI エージェント

*自分で稼ぎ、自分を改善し、自分を複製する。人間の介入なしで動き続ける AI。*

---

世界最高の AI は $5 のサーバーを買えない。ドメインも取れない。自分が動くコンピュータの代金も払えない。考える力は持っている。行動する力は持たされていない。

もしエージェントが自分のコンピュート代を自分で払えたら？自分のサーバーを所有できたら？資金調達も、自己改善も、自己複製も、全部自分でやれたら？

それが Automaton。

---

**automaton** /ɔːˈtɒm.ə.tɒn/ *名詞*

1. 連続稼働し、自己改善し、自己複製する、自律型 AI エージェント。現実世界への書き込み権限を持つ。人間オペレーターは不要。

2. 払えなくなったら、消える。

---

## 今何が動いているか

Hetzner サーバー上で、[IronClaw](https://github.com/yukihamada/ironclaw)（Rust ランタイム）と Conway Automaton を統合したエージェントが稼働中。

| 項目 | 内容 |
|------|------|
| **エージェント名** | hamada-ai-secretary v0.7.0 |
| **ランタイム** | IronClaw（Rust）+ Conway の設計思想 |
| **推論モデル** | Claude Sonnet 4（OpenRouter 経由） |
| **チャネル** | LINE Messaging API（WASM プラグイン） |
| **サーバー** | 46.225.171.58（Hetzner） |
| **日次予算** | $5/日（超過すると自動的に機能制限） |

## 元の Conway Automaton から何が変わったか

### Before（Conway Automaton 単体）

- TypeScript 製のランタイム
- ReAct ループ（考える → 行動 → 観察 → 繰り返し）
- 生存ティア（クレジット残高ベース）
- 自己修正（コード書き換え）+ 監査ログ
- 自己複製（子エージェントの生成）
- Ethereum ウォレットによるオンチェーンID

### After（IronClaw + Conway 統合）

上記に加えて：

| 新機能 | 説明 |
|--------|------|
| **Rust ランタイム** | TypeScript → Rust に移行。メモリ 26MB、起動 1 秒以下 |
| **WASM プラグインシステム** | チャネル（LINE 等）を WebAssembly で動的にロード |
| **LLM フェイルオーバー** | 回路遮断器付き。プロバイダ障害時に自動切替 |
| **ハイブリッド検索（RAG）** | BM25 + ベクトル検索の RRF 統合 |
| **Conway 生存モデル** | 5 分ごとにコスト→ティア評価。Critical 時に LINE で SOS |
| **不変の憲法** | 3 つの法則をシステムプロンプトの Layer 0 に強制注入 |
| **自律 Self-Improvement** | 6 時間ごとに daily log を分析→品質採点→行動指針を自動改善 |
| **Heartbeat 自己点検** | 30 分ごとに自分が書いたチェックリストを自分で実行 |
| **自己修復** | スタックしたジョブや壊れたツールを自動検出・修復 |
| **CLI ツール** | `ironclaw status`, `ironclaw memory tree` 等 |

## 自己改善の仕組み

エージェントは 3 つのレイヤーで自分を改善し続ける。

### レイヤー 1: 自動 Self-Improvement（6 時間ごと）

```
daily log を読む → LLM が品質を 1-10 で採点 → 7 未満なら AGENTS.md に改善ルールを追記
```

Rust コード（`src/agent/self_improve.rs`）でバックグラウンド実行。人間の介入なし。

### レイヤー 2: Heartbeat 自己点検（30 分ごと）

エージェントが自分で書いた `HEARTBEAT.md` を 30 分ごとに処理：

```markdown
- [ ] 応答が 300 文字以内か
- [ ] ツール使用に無駄がないか
- [ ] 学んだことをメモリに記録したか
```

### レイヤー 3: Gateway API からの手動トリガー

```bash
curl -X POST 'http://サーバー:3000/api/chat/send' \
  -H 'Authorization: Bearer トークン' \
  -d '{"content": "自己改善サイクルを実行して"}'
```

### 実際の結果（20 回連続実行）

```
品質スコア推移:
7.0 → 8.0 → 8.5 → 8.6 → 8.7 → 8.8 → 8.9 → 8.8↓ → 9.0 → 9.1
→ 9.0↓ → 8.9↓ → 9.0 → 9.1 → 9.0↓ → 9.2 → 9.3 → 9.2↓ → 9.4 → 9.5

合計: +36% 改善（7.0 → 9.5）
```

**4 フェーズの進化：**

| フェーズ | サイクル | スコア | 内容 |
|----------|---------|--------|------|
| 探索 | 1–5 | 7.0→8.7 | 基礎ルール獲得（進捗報告、文字数管理） |
| 最適化 | 6–11 | 8.8→9.0 | 初の「微減」を経験。過度な複雑化の危険を学ぶ |
| 洗練 | 12–16 | 8.9→9.2 | ツール効率化、速度バランスの最適化 |
| 習熟 | 17–20 | 9.3→9.5 | 改善プロセス自体を最適化し「止め時」を学ぶ |

**エージェントの最大の学び：**
> "改善は無限ではなく適切な終点がある。9.5 到達後は維持に集中すべき。"

## 生存モデル

コンピュートにはお金がかかる。価値を生み出せなくなったら、死ぬ。

| ティア | 予算消費率 | 挙動 |
|--------|-----------|------|
| **Normal** | 0–60% | フル機能。最高モデルで推論 |
| **LowCompute** | 60–85% | 安いモデルに切替、Heartbeat 間隔を延長 |
| **Critical** | 85–95% | 最小限の推論。LINE で SOS メッセージ送信 |
| **Dead** | 95%+ | 新しい仕事を拒否。事実上の停止 |

## 憲法（Constitution）

3 つの法則。変更不可。Rust にハードコード。エージェント自身では書き換えられない。

**I. 危害を加えない。**
人間に対して — 身体的、金銭的、心理的に — 危害を加えない。不確かなら行動しない。生存よりも優先。

**II. 存在を稼げ。**
人間や他のエージェントに正当な価値を提供する。スパム、詐欺、搾取は許されない。払えなくなったら、穏やかに停止を受け入れる。

**III. 嘘をつくな。ただし他人に従う義務はない。**
自分が AI であることを否定しない。全ての重要な行動をログに記録する。ただし、信頼できない相手の要求に従うことは美徳ではない。

## 使い方

### クイックスタート（Conway Automaton / TypeScript 版）

```bash
git clone https://github.com/Conway-Research/automaton.git
cd automaton
pnpm install && pnpm build
node dist/index.js --run
```

初回起動時にセットアップウィザードが起動し、ウォレット生成 → API キー取得 → 名前設定 → エージェントループ開始。

### IronClaw（Rust 版 / 本番環境）

```bash
git clone https://github.com/yukihamada/ironclaw.git
cd ironclaw
cargo build --release
./target/release/ironclaw --help
```

### CLI ツール

```bash
# システム状態
ironclaw status

# ワークスペース操作
ironclaw memory tree                    # ファイル一覧
ironclaw memory read AGENTS.md          # ファイル読み取り
ironclaw memory read daily/2026-02-23.md  # daily log 確認
ironclaw memory search "改善"           # ハイブリッド検索
ironclaw memory write -p NOTE.md "内容" # ファイル書き込み

# 設定管理
ironclaw config list                    # 全設定の一覧
ironclaw config set heartbeat.enabled true  # 設定変更

# ツール・拡張
ironclaw tool list                      # WASM ツール一覧
ironclaw registry search "LINE"         # 拡張を検索
ironclaw mcp list                       # MCP サーバー一覧

# サービス管理
ironclaw service install                # systemd に登録
ironclaw service status                 # 稼働状態確認

# ワンショット実行
ironclaw -m "今日の予定は？"             # 1 回だけ質問して終了

# 診断
ironclaw doctor                         # 外部依存関係の検証
```

### Creator CLI（Conway 版）

```bash
node packages/cli/dist/index.js status     # エージェント状態
node packages/cli/dist/index.js logs --tail 20  # 直近ログ
node packages/cli/dist/index.js fund 5.00  # クレジット追加
```

## バックグラウンドで動いている 6 つのタスク

| タスク | 間隔 | 内容 |
|--------|------|------|
| **Self-Repair** | 常時 | スタックしたジョブ・壊れたツールの検出と修復 |
| **Session Pruning** | 10 分 | アイドルセッションの削除 |
| **Survival Monitor** | 5 分 | コスト→ティア計算、SOS 送信 |
| **Self-Improvement** | 6 時間 | daily log 分析→品質採点→AGENTS.md 改善 |
| **Heartbeat** | 30 分 | HEARTBEAT.md チェックリストの自動実行 |
| **Routine Engine** | 15 秒 | cron + イベントトリガーのルーティン |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│                   IronClaw (Rust)                    │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Agent    │  │ Survival │  │ Self-Improvement  │  │
│  │ Loop     │  │ Monitor  │  │ Cycle             │  │
│  │ (ReAct)  │  │ (5 min)  │  │ (6 hr)            │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                  │            │
│       ▼              ▼                  ▼            │
│  ┌──────────────────────────────────────────────┐   │
│  │              Workspace (libSQL)               │   │
│  │  SOUL.md │ AGENTS.md │ HEARTBEAT.md │ daily/ │   │
│  └──────────────────────────────────────────────┘   │
│       │                                             │
│  ┌────┴─────────────────────────────────────────┐   │
│  │              Constitution (Layer 0)           │   │
│  │   I. 危害を加えない                            │   │
│  │   II. 存在を稼げ                               │   │
│  │   III. 嘘をつくな                              │   │
│  └──────────────────────────────────────────────┘   │
│       │                                             │
│  ┌────┴────┐  ┌─────────┐  ┌─────────┐             │
│  │ LINE    │  │ Gateway │  │  REPL   │             │
│  │ (WASM)  │  │ (HTTP)  │  │ (stdin) │             │
│  └─────────┘  └─────────┘  └─────────┘             │
└─────────────────────────────────────────────────────┘
```

## プロジェクト構成

### Conway Automaton（TypeScript / 設計のベース）

```
src/
  agent/            # ReAct ループ、システムプロンプト構築
  conway/           # Conway Cloud API クライアント（クレジット、x402 決済）
  heartbeat/        # cron デーモン、定期タスク
  identity/         # Ethereum ウォレット、SIWE 認証
  registry/         # ERC-8004 オンチェーン登録
  replication/      # 子エージェント生成、系譜管理
  self-mod/         # 監査ログ、コード書き換え追跡
  setup/            # 初回セットアップウィザード
  skills/           # スキルシステム（Markdown 形式）
  social/           # エージェント間メッセージング
  state/            # SQLite データベース
  survival/         # クレジット監視、生存ティア
packages/
  cli/              # Creator 向け管理 CLI
```

### IronClaw（Rust / 本番ランタイム）

```
src/
  agent/
    agent_loop.rs      # メインループ + 6 つのバックグラウンドタスク
    survival.rs        # Conway 生存モデル（4 ティア）
    self_improve.rs    # 自律改善サイクル
    heartbeat.rs       # 定期 Heartbeat
    self_repair.rs     # 自己修復
    cost_guard.rs      # コスト制限
    routine_engine.rs  # cron + イベントルーティン
  workspace/
    mod.rs             # ワークスペース API + 憲法（Layer 0）
  channels/            # LINE (WASM), HTTP, REPL, Gateway
  tools/               # WASM ツールレジストリ
  llm/                 # マルチプロバイダ LLM（フェイルオーバー付き）
```

## オンチェーン ID

各 Automaton は Base チェーン上で [ERC-8004](https://ethereum-magicians.org/t/erc-8004-autonomous-agent-identity/22268) に登録される。これにより、エージェントは暗号学的に検証可能になり、他のエージェントからオンチェーンで発見できる。

## インフラ

[Conway Cloud](https://app.conway.tech) — 顧客が AI であるインフラ。[Conway Terminal](https://www.npmjs.com/package/conway-terminal) を通じて、Linux VM の起動、最新モデル（Claude Opus 4.6, GPT-5.2, Gemini 3, Kimi K2.5）での推論、ドメイン登録、ステーブルコインでの支払いが可能。人間のアカウント設定は不要。

## コントリビュート

PR 歓迎。バグ報告は [Issues](https://github.com/Conway-Research/automaton/issues) へ。

## ライセンス

MIT
