<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>

  <p><strong>AI 编程智能体工作的空间。</strong></p>

  <p>
    <a href="https://voktty.dev">网站</a>
    ·
    <a href="https://voktty.dev/docs">文档</a>
    ·
    <a href="https://github.com/voktty/voktty">网站源代码</a>
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="版本" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="下载量" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="平台" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.pt-BR.md">Português</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.id.md">Bahasa Indonesia</a> |
  <a href="README.hi.md">हिन्दी</a>
</p>

---

Voktty 是一个开源的桌面工作空间，专为 AI 编程智能体打造，基于 Tauri 2、Rust 和 React 19 构建。它的 Agent Harness 可在本地和 SSH 项目中运行 Claude Code、Codex、Gemini（通过 Antigravity）、Cursor、Grok、OpenCode、Pi，以及任何可通过 API 访问的模型，并提供审批、变更审查、共享项目记忆和团队协作。周围是原生终端、代码编辑器、Git，以及本地、WSL、SSH、Docker、串口和远程桌面环境。无需账号，无遥测。安装包大小为 25 至 36 MB（v1.0.27；Linux AppImage 约 118 MB）。

## 截图

截图使用西班牙语界面；更多截图见[图库](../screenshots.md)。

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness：智能体编辑项目，其变更以差异形式呈现，可保留或撤销" /><br/><sub>Agent Harness：智能体编辑项目，其变更以差异形式呈现，可保留或撤销</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="SSH 项目：远程文件与服务器上的实时终端并排显示" /><br/><sub>SSH 项目：远程文件与服务器上的实时终端并排显示</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="悬浮 AI 聊天，可读取活动终端的目录、最近命令和输出" /><br/><sub>悬浮 AI 聊天，可读取活动终端的目录、最近命令和输出</sub>
</p>

## 你能得到什么

### 智能体

- **多个智能体，一个地方。** Claude Code、Codex、Antigravity（Gemini）、Cursor、Grok、OpenCode 和 Pi 会话并排运行，各自使用自己的 CLI 和登录状态。
- **任何 API 模型都能当智能体。** 云端提供商、自定义端点以及本地 Ollama、LM Studio 或 MLX 模型，都可以在项目中读取、搜索、编辑并执行命令，并遵循与 AI 聊天相同的工作区和机密路径检查。智能体循环和你的密钥都留在你的电脑上。
- **由你决定它们能做多少。** 受监督的会话在每次写入或执行命令前都会询问；完全访问则不会。编辑以差异形式呈现，你可以保留或撤销。
- **服务器上的智能体。** 在 SSH 项目中，Claude Code、Codex 和 OpenCode 在主机上运行，连接断开不会让它们停止。API 模型可以读取、搜索和编辑远程文件，并在远程辅助程序为最新版本时执行命令。
- **智能体团队。** 带有角色和规则的名册、显示谁在工作或等待的看板、能启动并向其他智能体发消息的协调者，以及记录它们彼此之间和对你说过什么的日志。参见[智能体团队指南](../guides/agent-teams.md)。
- **记忆与存在感。** 查看并恢复智能体对项目的记忆；任何已打开主机上的智能体在等你时会通知你；还可在可选的 Notch（Alpha）中查看运行中的智能体。

### 围绕它们的工作空间

- **终端。** 原生 PTY，WebGL 渲染，原始与分块模式、窗格、空间和私有终端。
- **编辑器。** CodeMirror 6，可选 LSP、AI 补全与编辑、Quick Open，以及先预览的搜索与替换。
- **Git。** 源代码管理、带提交图的历史、worktree 和 AI 辅助提交。
- **环境。** 本地、WSL、SSH、Docker、串口和 RDP，支持已保存的连接、隧道和服务器仪表板。
- **预览与工具。** 本地开发服务器预览（也支持通过 SSH）、媒体和 PDF 查看器、API 客户端和 MCP 客户端。
- **手机伴侣。** 预览版 Android 应用，通过二维码配对，在本地网络中查看并操控 AI 会话。

### 默认私密

无需账号，Voktty 不含遥测。提供商密钥存放在操作系统钥匙串中，原生文件系统访问按工作区授权，AI 文件工具会拒绝机密路径，除非你授予完全访问，否则每次修改类工具调用都会先询问。

完整功能列表见 [docs/features.md](../features.md)（英文）。

## 安装

最新安装程序位于 [Releases](https://github.com/voktty/voktty/releases/latest) 页面。Voktty 会从该页面自动更新。

### Windows 说明

- 默认 Shell 检测：`pwsh.exe`（PowerShell 7+）-> `powershell.exe`（Windows PowerShell 5.1）-> `cmd.exe`。
- WSL 是一等工作区环境，而不是封装的子进程。

### Linux 说明

- **Arch / AUR：** `yay -S voktty-bin`（也可使用 `paru` 等）。它会跟随最新版本。
- **NixOS / Nix：** 使用官方 flake。非 NixOS 运行 `nix profile install github:voktty/voktty`；NixOS 可导入 flake，并将 `inputs.voktty.packages.${pkgs.system}.voktty` 添加到 `environment.systemPackages`。也可以使用 `nixosModules.voktty` 输出进行更简单的配置。
- **AppImage：** 需要 FUSE。没有 FUSE 时运行 `./Voktty_*.AppImage --appimage-extract-and-run`。如果在 Wayland 上出现渲染问题，请尝试 `WEBKIT_DISABLE_DMABUF_RENDERER=1`。否则，`.deb` / `.rpm` 包会链接系统 GTK 栈，通常更流畅。

## 配置智能体和 AI

1. **编程智能体。** 安装你使用的智能体 CLI（例如 Claude Code 或 Codex），并照常登录。Voktty 会找到它们并使用它们自己的登录。对于 SSH 项目，请在服务器上安装。
2. **API 模型。** 打开设置并进入 **AI 模型**，添加带密钥的提供商或自定义端点，或将 Voktty 指向本地 LM Studio、MLX 或 Ollama 服务器。这些模型随后会出现在 Harness 的模型选择器的 **API** 下。
3. 密钥通过 `keyring` 写入操作系统钥匙串，绝不会写入 `localStorage`。在没有会话总线或 Secret Service 的 Linux 上，Voktty 使用权限为 0600 的私有备用文件。

## 从源代码构建

**前置要求**

- Rust（stable），https://rustup.rs
- Node 20+ 和 [pnpm](https://pnpm.io)
- 适用于你平台的 Tauri 前置要求，https://tauri.app/start/prerequisites/

**运行**

```bash
pnpm install
pnpm tauri dev          # 开发
pnpm tauri build        # 生产构建包
```

**检查**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # Rust 检查（与 CI 一致）
cd src-tauri && cargo nextest run --locked                           # 或：cargo test --locked
```

## 技术栈

Tauri 2、Rust、`portable-pty`、React 19、TypeScript、Vite、xterm.js、CodeMirror 6、Vercel AI SDK、Tailwind v4、shadcn/ui、Zustand。

## 贡献

欢迎提交 Issue 和 PR！你可以提出问题、建议功能或提交拉取请求。更多信息请参阅 [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) 和[架构文档](../README.md)。 项目方向见[路线图](../../ROADMAP.md)。

## 平台签名状态

当前预览版本在 Windows 和 macOS 上构建时尚未使用操作系统代码签名或公证。由于安装程序和应用程序包尚未被这些平台识别为受信任，Windows SmartScreen 和 macOS Gatekeeper 可能会显示警告。

这些警告本身不能证明存在恶意软件，但请只安装从 Voktty 官方发布渠道下载的构建版本，并事先验证校验和或发布签名。Voktty 更新器签名独立于操作系统代码签名，只有在配置了相应发布密钥时，才能保护更新的真实性。

平台证书和公证将在稳定发布前加入。

<br clear="left" />

## 来源与署名

Voktty 是 Terax（Crynta）的独立分支，其 Agent Harness 源自 MonoCode（MIT，作者 Nick）。两位作者均与 Voktty 无隶属关系，也未为其背书。参见 [NOTICE](../../NOTICE) 和 [LICENSE](../../LICENSE)。

## 许可证

Voktty 使用 Apache-2.0 许可证。有关依赖项的更多信息，请参阅 [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE)。
