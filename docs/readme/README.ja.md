<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>コーディングエージェントが働くワークスペース。</strong></p>
  <p><a href="https://voktty.dev">ウェブサイト</a> · <a href="https://voktty.dev/docs">ドキュメント</a> · <a href="https://github.com/voktty/voktty">ウェブサイトのソースコード</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="バージョン" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="ダウンロード" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="プラットフォーム" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ko.md">한국어</a> | <a href="README.pt-BR.md">Português</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.id.md">Bahasa Indonesia</a> | <a href="README.hi.md">हिन्दी</a>
</p>

---

Voktty は、AI コーディングエージェントのためのオープンソースのデスクトップワークスペースで、Tauri 2、Rust、React 19 で構築されています。Agent Harness は、Claude Code、Codex、Gemini（Antigravity 経由）、Cursor、Grok、OpenCode、Pi、そして API で利用できる任意のモデルを、ローカルと SSH のプロジェクトで実行し、承認、変更レビュー、共有プロジェクトメモリ、チーム連携を提供します。周囲には、ネイティブターミナル、コードエディタ、Git、そしてローカル、WSL、SSH、Docker、シリアル、リモートデスクトップの各環境があります。アカウント不要、テレメトリなし。インストーラーのサイズは 25〜36 MB です（v1.0.27。Linux の AppImage は約 118 MB）。

## スクリーンショット

スクリーンショットはスペイン語のインターフェースです。ほかの画像は[ギャラリー](../screenshots.md)にあります。

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness：エージェントがプロジェクトを編集し、変更が保持または元に戻せる差分として表示されます" /><br/><sub>Agent Harness：エージェントがプロジェクトを編集し、変更が保持または元に戻せる差分として表示されます</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="SSH プロジェクト：リモートのファイルとサーバー上のライブターミナルを並べて表示" /><br/><sub>SSH プロジェクト：リモートのファイルとサーバー上のライブターミナルを並べて表示</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="アクティブなターミナルのディレクトリ、最近のコマンド、出力を読み取るフローティング AI チャット" /><br/><sub>アクティブなターミナルのディレクトリ、最近のコマンド、出力を読み取るフローティング AI チャット</sub>
</p>

## できること

### エージェント

- **多数のエージェントを一か所で。** Claude Code、Codex、Antigravity（Gemini）、Cursor、Grok、OpenCode、Pi のセッションを並べて実行し、それぞれ独自の CLI とログインを使います。
- **あらゆる API モデルをエージェントに。** クラウドプロバイダー、カスタムエンドポイント、ローカルの Ollama、LM Studio、MLX のモデルが、AI チャットと同じワークスペースと秘密パスのチェックのもとで、プロジェクト内の読み取り、検索、編集、コマンド実行を行えます。エージェントのループとキーはお使いのコンピューターに残ります。
- **どこまで許すかはあなたが決めます。** 監督付きセッションは書き込みやコマンドのたびに確認し、フルアクセスでは確認しません。編集は、保持または元に戻せる差分として表示されます。
- **サーバー上のエージェント。** SSH プロジェクトでは、Claude Code、Codex、OpenCode がホスト上で動作し、接続が切れても停止しません。API モデルはリモートファイルの読み取り、検索、編集を行い、リモートヘルパーが最新ならコマンドも実行します。
- **エージェントのチーム。** 役割とルールを持つ名簿、誰が作業中か待機中かを示すボード、ほかのエージェントを起動してメッセージを送るオーケストレーター、そして互いやあなたに伝えた内容のログ。[エージェントチームガイド](../guides/agent-teams.md)を参照してください。
- **メモリとプレゼンス。** エージェントがプロジェクトについて覚えていることを確認して復元し、開いているどのホストでもエージェントがあなたを待っていれば通知を受け取り、オプションの Notch（アルファ）で実行中のエージェントを確認できます。

### それを取り巻くワークスペース

- **ターミナル。** WebGL 描画のネイティブ PTY、ローとブロックのモード、ペイン、スペース、プライベートターミナル。
- **エディタ。** CodeMirror 6、オプトインの LSP、AI による補完と編集、Quick Open、プレビュー付きの検索と置換。
- **Git。** ソース管理、コミットグラフ付きの履歴、worktree、AI 支援のコミット。
- **環境。** ローカル、WSL、SSH、Docker、シリアル、RDP。保存済み接続、トンネル、サーバーダッシュボードに対応。
- **プレビューとツール。** ローカル開発サーバーのプレビュー（SSH 経由も可）、メディアと PDF のビューアー、API クライアント、MCP クライアント。
- **スマートフォン連携。** QR コードでペアリングし、ローカルネットワーク経由で AI セッションを確認・操作できるプレビュー版 Android アプリ。

### デフォルトでプライベート

アカウント不要で、Voktty のテレメトリはありません。プロバイダーのキーは OS のキーチェーンに保存され、ネイティブのファイルシステムアクセスはワークスペースごとに承認され、AI のファイルツールは秘密パスを拒否し、フルアクセスを許可しない限り、変更を伴うツール呼び出しは毎回確認します。

機能の完全な一覧は [docs/features.md](../features.md)（英語）にあります。

## インストール

最新のインストーラーは [Releases](https://github.com/voktty/voktty/releases/latest) ページにあります。Voktty はそこから自動更新されます。

### Windows の注意事項

- 既定のシェル検出: `pwsh.exe`（PowerShell 7+）-> `powershell.exe`（Windows PowerShell 5.1）-> `cmd.exe`。
- WSL はラップされた子プロセスではなく、第一級のワークスペース環境です。

### Linux の注意事項

- **Arch / AUR:** `yay -S voktty-bin`（または `paru` など）。最新版を追跡します。
- **NixOS / Nix:** 公式 flake を使用します。NixOS 以外では `nix profile install github:voktty/voktty`、NixOS では flake をインポートし、`inputs.voktty.packages.${pkgs.system}.voktty` を `environment.systemPackages` に追加します。より簡単な設定には `nixosModules.voktty` も利用できます。
- **AppImage:** FUSE が必要です。ない場合は `./Voktty_*.AppImage --appimage-extract-and-run` を実行してください。Wayland で描画に問題がある場合は `WEBKIT_DISABLE_DMABUF_RENDERER=1` を試してください。`.deb` / `.rpm` はシステムの GTK スタックを使用するため、通常はより滑らかです。

## エージェントと AI を設定する

1. **コーディングエージェント。** 使用するエージェントの CLI（たとえば Claude Code や Codex）をインストールし、いつも通りサインインします。Voktty はそれらを見つけ、それぞれのログインを使います。SSH プロジェクトでは、サーバーにインストールしてください。
2. **API モデル。** 設定を開いて **AI モデル** に進み、キー付きのプロバイダーまたはカスタムエンドポイントを追加するか、ローカルの LM Studio、MLX、Ollama サーバーを指定します。モデルは Harness のモデル選択の **API** に表示されます。
3. キーは `keyring` 経由で OS のキーチェーンに保存され、`localStorage` には書き込まれません。セッションバスや Secret Service がない Linux では、Voktty はモード 0600 のプライベートなフォールバックファイルを使います。

## ソースからビルド

**前提条件**

- Rust（stable）、https://rustup.rs
- Node 20+ と [pnpm](https://pnpm.io)
- プラットフォームごとの Tauri 前提条件、https://tauri.app/start/prerequisites/

**実行**

```bash
pnpm install
pnpm tauri dev          # 開発
pnpm tauri build        # 本番バンドル
```

**チェック**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # CI と同じ Rust lint
cd src-tauri && cargo nextest run --locked                           # または cargo test --locked
```

## 技術スタック

Tauri 2、Rust、`portable-pty`、React 19、TypeScript、Vite、xterm.js、CodeMirror 6、Vercel AI SDK、Tailwind v4、shadcn/ui、Zustand。

## コントリビューション

Issue と PR を歓迎します。問題の報告、機能提案、Pull Request を送信できます。詳しくは [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) と[アーキテクチャ文書](../README.md)を参照してください。 プロジェクトの方向性は[ロードマップ](../../ROADMAP.md)にあります。

## プラットフォーム署名の状態

現在のプレビュービルドは、Windows と macOS 向けにオペレーティングシステムのコード署名および公証なしで作成されています。インストーラーとアプリケーションバンドルはこれらのプラットフォームでまだ信頼済みとして認識されていないため、Windows SmartScreen や macOS Gatekeeper が警告を表示する場合があります。

これらの警告だけでマルウェアだと判断することはできませんが、Voktty の公式リリース経路から取得し、チェックサムまたはリリース署名を確認したビルドだけをインストールしてください。Voktty のアップデーター署名はオペレーティングシステムのコード署名とは別であり、対応するリリースキーが設定されている場合にのみ更新の真正性を保護します。

プラットフォーム証明書と公証は安定版の配布前に追加されます。

<br clear="left" />

## 由来と帰属

Voktty は Terax（Crynta）から独立したフォークであり、その Agent Harness は MonoCode（MIT、作者 Nick）に由来します。どちらの作者も Voktty とは無関係で、支持もしていません。[NOTICE](../../NOTICE) と [LICENSE](../../LICENSE) を参照してください。

## ライセンス

Voktty は Apache-2.0 ライセンスです。依存関係については [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE) を参照してください。
