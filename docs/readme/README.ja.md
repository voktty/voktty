<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>軽量でターミナル中心の AI ネイティブ開発ワークスペース。</strong></p>
  <p><a href="https://voktty.dev">ウェブサイト</a> · <a href="https://voktty.dev/docs">ドキュメント</a> · <a href="https://github.com/voktty/voktty">ウェブサイトのソースコード</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="バージョン" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="ダウンロード" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="プラットフォーム" />
    <a href="https://discord.gg/tyveTUyEp7"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ko.md">한국어</a> | <a href="README.pt-BR.md">Português</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.id.md">Bahasa Indonesia</a> | <a href="README.hi.md">हिन्दी</a>
</p>

---

Voktty は、Tauri 2 + Rust と React 19 で構築された、軽量かつオープンソースのターミナル中心 AI ネイティブ開発環境（ADE）です。WebGL レンダラーを備えたネイティブ PTY バックエンド、自分のキーまたは完全なローカルモデルで動作するエージェント型 AI サイドパネル、コードエディター、ファイルエクスプローラー、Git グラフ付きソース管理、ウェブプレビューパネルを内蔵しています。ディスク使用量は約 7-8 MB。テレメトリなし。アカウント不要。

## スクリーンショット

<table>
  <tr><td align="center"><img src="../images/voktty_0stHyTBbyY.png" alt="ワークスペース" /><br/><sub>ファイルとタブを備えた Voktty ワークスペース</sub></td><td align="center"><img src="../images/voktty_ljubKqX22C.png" alt="ターミナル Copilot" /><br/><sub>自然言語で使えるターミナル Copilot</sub></td></tr>
  <tr><td align="center"><img src="../images/voktty_kLd3UCiAji.png" alt="テーマ" style="margin-top: 12px;"/><br/><sub>カスタムテーマとプリセット</sub></td><td align="center"><img src="../images/voktty_kiAdbgrGGj.png" alt="ソース管理と Git グラフ" style="margin-top: 12px;"/><br/><sub>Git グラフを備えたソース管理パネル</sub></td></tr>
  <tr><td colspan="2" align="center"><img src="../images/voktty_wiRVOca2A5.png" alt="ターミナル" style="border-radius: 4px; margin-top: 12px;" /><br/><sub>システム情報とファイルエクスプローラーを備えたターミナル</sub></td></tr>
</table>

## 機能

### ターミナル

- WebGL レンダラー、マルチタブ、バックグラウンドストリーミング対応の xterm.js
- エディターのようなコマンド入力を備えた GPU アクセラレーション対応ブロック型ターミナル
- `portable-pty` によるネイティブ PTY バックエンド（zsh、bash、pwsh、fish、cmd）
- 水平および垂直の分割パネル
- インライン検索、リンク検出、True Color
- エクスプローラーやデスクトップからファイルをドラッグし、シェルで安全に引用されたパスとして入力
- Windows のタブごとのワークスペース環境（Local またはインストール済みの WSL ディストリビューション）
- Spaces がタブ、作業ディレクトリ、分割レイアウトを次回起動時に復元

### コードエディター

- CodeMirror 6（TS/JS、Rust、Python、Go、C/C++、Java、HTML/CSS、JSON、Markdown など主要言語に対応）
- ローカルモデル対応のインライン AI 自動補完
- AI 編集差分をハンク単位で承認または拒否
- 診断、ナビゲーション、補完、フォーマット、カスタムサーバーに対応したオプトインの言語サーバー
- Markdown のレンダリングと画像、動画、音声、PDF の表示
- Vim モード
- Kanagawa、Catppuccin、Rosé Pine、Everforest、Dracula、Solarized、Nord、Tokyo Night、GitHub、Xcode などの内蔵テーマ

### ソース管理

- ハンクのステージ / アンステージ、コミット（Cmd+Enter / Ctrl+Enter）、上流を認識したプッシュ
- Detached HEAD 状態を含むブランチ表示
- マージとブランチのレーンを描画する実際のコミットグラフ付き Git 履歴
- コミットの検索と絞り込み、リモートのコミットページへの移動

### ファイルエクスプローラー

- Catppuccin アイコンテーマ
- あいまい検索、キーボード操作、インライン名前変更、コンテキスト操作
- ディスク上のファイル変更をリアルタイムに反映
- ファイルや選択範囲を AI サイドパネルへ直接添付

### ウェブプレビュー

- ローカル開発サーバーを自動検出してプレビュータブで開く
- ネイティブ子 WebView による外部 URL のプレビュー

### テーマとカスタマイズ

- アプリ内でカスタムテーマを作成し、内蔵プリセットと切り替え
- テーマの共有やコミュニティからのインポート
- 不透明度とぼかしを調整できる背景画像
- エディターテーマはアプリテーマから独立

### AI

- **BYOK プロバイダー:** OpenAI、Anthropic、Google（Gemini）、Groq、xAI（Grok）、Cerebras、OpenRouter、DeepSeek、Mistral、任意の OpenAI 互換エンドポイント
- **ローカル / オフライン:** LM Studio、MLX、Ollama
- **エージェント型ワークフロー:** 計画、サブエージェント、`VOKTTY.md` によるプロジェクトメモリ、ファイルの読み取り / 書き込み / 編集 / 複数編集 / grep / glob、承認付き bash、バックグラウンドプロセス
- **コーディングエージェントの連携:** ターミナルで Claude Code を起動し、出力を確認して、承認付きツールから追加作業を送信
- **コンポーザー:** `#handle` のプロンプトスニペット、`@path` のファイル、音声入力、エクスプローラーや選択範囲からの添付
- 独自のシステムプロンプトとツールセットを持つ**カスタムエージェント**
- 実行前に計画を生成して確認する**プランモード**

## Voktty の最新機能

- **フラットな複合 Spaces：** 独立したタブを名前付き Spaces から分離し、メンバーを決定的に並べ替えられます。2、4、6、8 個のビューに対応し、Spaces の入れ子は作りません。
- **IDE とデバッグ：** CodeMirror 6、シンボルナビゲーション、Problems パネル、コードアクション、Ghost 補完、diff で確認できる編集、互換アダプター設定時の DAP デバッグを提供します。
- **安全な MCP クライアント：** ローカル stdio サーバーまたはリモート Streamable HTTP サーバーに接続できます。ツールは検証され、変更操作にはネイティブの一回限りの承認が必要です。
- **ネイティブ拡張：** `~/.voktty/extensions/` の JavaScript 拡張からコマンド、ショートカット、AI ツール、通知、workspace 操作を追加できます。Voktty 独自 API であり、VS Code 拡張互換ではありません。
- **ターミナル共同作業：** オブザーバー／コントローラーの役割、追加の暗号化、読み取り専用のリモートファイル引用を備えた一時的なターミナル共有です。
- **接続と性能：** Local、WSL、SSH、Docker、シリアル環境が接続ライフサイクルを表示します。非表示のターミナルは実行中のプロセスを停止せず、高コストなレンダラーを解放します。
- **エージェントの状態表示：** 役割別アバター、外部エージェントのアニメーションアイコン、保存・Git・Problems・デバッグ・エージェント応答用の任意のローカルサウンドを提供し、視覚効果の低減にも対応します。

セキュリティ境界とプラットフォームごとの対応状況を含む完全な機能一覧は、[英語版 README](../../README.md)にあります。

## インストール

最新のインストーラーは [Releases](https://github.com/voktty/voktty/releases/latest) ページにあります。Voktty はそこから自動更新されます。

### Windows の注意事項

- 既定のシェル検出: `pwsh.exe`（PowerShell 7+）-> `powershell.exe`（Windows PowerShell 5.1）-> `cmd.exe`。
- WSL はラップされた子プロセスではなく、第一級のワークスペース環境です。

### Linux の注意事項

- **Arch / AUR:** `yay -S voktty-bin`（または `paru` など）。最新版を追跡します。
- **NixOS / Nix:** 公式 flake を使用します。NixOS 以外では `nix profile install github:voktty/voktty`、NixOS では flake をインポートし、`inputs.voktty.packages.${pkgs.system}.voktty` を `environment.systemPackages` に追加します。より簡単な設定には `nixosModules.voktty` も利用できます。
- **AppImage:** FUSE が必要です。ない場合は `./Voktty_*.AppImage --appimage-extract-and-run` を実行してください。Wayland で描画に問題がある場合は `WEBKIT_DISABLE_DMABUF_RENDERER=1` を試してください。`.deb` / `.rpm` はシステムの GTK スタックを使用するため、通常はより滑らかです。

## AI の設定

1. **設定 -> AI** を開きます。
2. プロバイダーを選び API キーを貼り付けます。ローカル推論では LM Studio / MLX / Ollama エンドポイントを指定します。
3. キーは `keyring` を通して OS のキーチェーンに保存されます。ディスクや localStorage には一切書き込まれません。

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

Tauri 2、Rust、`portable-pty`、React 19、TypeScript、Vite、xterm.js、CodeMirror 6、Vercel AI SDK v6、Tailwind v4、shadcn/ui、Zustand。

## コントリビューション

Issue と PR を歓迎します。問題の報告、機能提案、Pull Request を送信できます。詳しくは [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) と[アーキテクチャ文書](../README.md)を参照してください。

## プラットフォーム署名の状態

現在のプレビュービルドは、Windows と macOS 向けにオペレーティングシステムのコード署名および公証なしで作成されています。インストーラーとアプリケーションバンドルはこれらのプラットフォームでまだ信頼済みとして認識されていないため、Windows SmartScreen や macOS Gatekeeper が警告を表示する場合があります。

これらの警告だけでマルウェアだと判断することはできませんが、Voktty の公式リリース経路から取得し、チェックサムまたはリリース署名を確認したビルドだけをインストールしてください。Voktty のアップデーター署名はオペレーティングシステムのコード署名とは別であり、対応するリリースキーが設定されている場合にのみ更新の真正性を保護します。

プラットフォーム証明書と公証は安定版の配布前に追加されます。

<br clear="left" />

## ライセンス

Voktty は Apache-2.0 ライセンスです。依存関係については [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE) を参照してください。
