<div align="center">
  <img src="voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>

  <p><strong>The workspace where your coding agents work.</strong></p>
  <p>
    <a href="https://voktty.dev">Website</a>
    ·
    <a href="https://voktty.dev/docs">Docs</a>
    ·
    <a href="https://github.com/voktty/voktty">Source code</a>
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="version" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="downloads" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="platform" /> 
  </p>
</div>

<p align="center">
  <a href="docs/readme/README.zh-CN.md">简体中文</a> |
  <a href="docs/readme/README.es.md">Español</a> |
  <a href="docs/readme/README.de.md">Deutsch</a> |
  <a href="docs/readme/README.fr.md">Français</a> |
  <a href="docs/readme/README.ja.md">日本語</a> |
  <a href="docs/readme/README.ko.md">한국어</a> |
  <a href="docs/readme/README.pt-BR.md">Português</a> |
  <a href="docs/readme/README.pl.md">Polski</a> |
  <a href="docs/readme/README.ru.md">Русский</a> |
  <a href="docs/readme/README.id.md">Bahasa Indonesia</a> |
  <a href="docs/readme/README.hi.md">हिन्दी</a>
</p>

---

Voktty is an open-source desktop workspace for AI coding agents, built on Tauri 2, Rust and React 19. Its Agent Harness runs Claude Code, Codex, Gemini (through Antigravity), Cursor, Grok, OpenCode, Pi and any model you reach through an API, on local and SSH projects, with approvals, change review, shared project memory and team coordination. Around it sit a native terminal, a code editor, Git, and local, WSL, SSH, Docker, serial and remote-desktop environments. No account, no telemetry. Installers are 25 to 36 MB (v1.0.27; the Linux AppImage is about 118 MB).

## Screenshots

The captures below use a Spanish interface and are grouped with more in the [screenshot gallery](docs/screenshots.md).

<p align="center">
  <img src="docs/images/harness-session-review.png" width="800" alt="Voktty Agent Harness session with an agent's changes shown as a reviewable diff" /><br/><sub>Agent Harness: an agent edits a project and its changes appear as a diff to keep or undo</sub>
</p>

<p align="center">
  <img src="docs/images/ssh-project-terminal.png" width="800" alt="Voktty SSH project with the remote file explorer beside a live terminal on the server" /><br/><sub>SSH project: remote files beside a live terminal on the server</sub>
</p>

<p align="center">
  <img src="docs/images/terminal-ai-chat.png" width="800" alt="Voktty floating AI chat over a terminal" /><br/><sub>Floating AI chat that reads the active terminal's directory, recent commands and output</sub>
</p>

## What you get

### Agents

- **Many agents, one place.** Run Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode and Pi sessions side by side. Voktty drives each tool's own CLI and its existing login, so your subscriptions keep working.
- **Any API model as an agent.** DeepSeek, OpenAI, Anthropic, Google, xAI, Cerebras, Groq, Mistral, OpenRouter, custom endpoints and local Ollama, LM Studio or MLX models can read, search, edit and run commands in a project, under the same workspace and secret-path checks as the AI chat. The agent loop and your key stay on your computer.
- **You decide how much they can do.** Supervised sessions ask before every write or command; full access does not. Edits appear as diffs you can keep or undo.
- **Agents on your servers.** For SSH projects, Claude Code, Codex and OpenCode run on the host through Voktty's remote helper, and a dropped connection does not stop them. API models read, search and edit remote files too, and run commands when the helper is up to date.
- **Teams of agents.** Declare a roster with roles and rules, watch a board of who is working or waiting, let an orchestrator start and message the others, and read what they tell each other and you. See the [agent teams guide](docs/guides/agent-teams.md).
- **Memory and presence.** Inspect and restore what agents remember about a project, get notified when an agent on any open host waits for you, and watch running agents in the optional Notch (alpha).

### The workspace around them

- **Terminal.** A native PTY with a WebGL renderer, raw and block modes, shell integration, panes, spaces and private terminals.
- **Editor.** CodeMirror 6 with opt-in LSP, AI completion and edits, Quick Open, and preview-first project search and replace.
- **Git.** Source control, history with a commit graph, worktrees and AI-assisted commits.
- **Environments.** Local, WSL, SSH, Docker, serial and RDP, with saved connections, tunnels and a server dashboard.
- **Previews and tools.** Local dev-server preview (also over SSH), media and PDF viewers, an API client, and an MCP client for your own tool servers.
- **Phone companion.** A preview Android app that pairs by QR code to follow and steer AI sessions over your local network.

### Private by default

No account and no Voktty telemetry. Provider keys live in the OS keychain, native filesystem access is authorized per workspace, AI file tools refuse secret paths, and every mutating tool call asks first unless you grant full access.

The complete feature list is in [docs/features.md](docs/features.md).

## Install

Latest installers are on the [Releases](https://github.com/voktty/voktty/releases/latest) page. Voktty auto-updates from there.

### Windows notes

- Default shell detection: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL is a first-class workspace environment, not a wrapped subprocess.

### Linux notes

- **Arch / AUR:** `yay -S voktty-bin` (or `paru`, etc.). Tracks the latest release.
- **NixOS / Nix**: use the official flake - `nix profile install github:voktty/voktty` (non-NixOS), or import the flake and add `inputs.voktty.packages.${pkgs.system}.voktty` to `environment.systemPackages` (NixOS). The `nixosModules.voktty` output is also available for a simpler setup.
- **AppImage:** needs FUSE. Without it: `./Voktty_*.AppImage --appimage-extract-and-run`. On Wayland with rendering glitches, try `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Otherwise the `.deb` / `.rpm` packages link against the system GTK stack and tend to be smoother.

## Set up agents and AI

1. **Coding agents.** Install the agent CLIs you use (for example Claude Code or Codex) and sign in to them as usual. Voktty finds them and uses their own login. For SSH projects, install them on the server.
2. **API models.** Open **Settings -> AI Models**, add a provider with its key or a custom endpoint, or point Voktty at a local LM Studio, MLX or Ollama server. The models then appear in the Harness model picker under **API**.
3. Keys are written to the OS keychain via `keyring` and never to `localStorage`. On Linux where the session bus or Secret Service is absent, Voktty uses a private mode-0600 fallback file.

## Build from source

**Prerequisites**
- Rust (stable), https://rustup.rs
- Node 22+ and [pnpm](https://pnpm.io)
- Tauri prerequisites for your platform, https://tauri.app/start/prerequisites/

**Run**
```bash
pnpm install
pnpm tauri dev          # development
pnpm tauri build        # production bundle
```

**Checks**
```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # Rust lint (matches CI)
cd src-tauri && cargo nextest run --locked                           # or: cargo test --locked
```

## Tech stack

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui, Zustand.

## Contributing

Issues and PRs are welcome! Feel free to open issues, suggest features, or submit pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [architecture docs](docs/README.md) for more details. The direction of the project is in the [roadmap](ROADMAP.md).

## Platform signing status

Current preview builds are compiled without operating-system code signing or notarization for Windows and macOS. Windows SmartScreen and macOS Gatekeeper may display warnings because the installers and application bundles are not yet trusted by those platforms.

These warnings do not by themselves prove malware, but only install a build downloaded from the official Voktty release channels after verifying its checksum or release signature. The Voktty updater signature is separate from operating-system code signing and protects update authenticity only when the corresponding release key is configured.

Platform certificates and notarization will be added before stable distribution.

## Origin and attribution

Voktty is an independent hard fork and derivative work based on Terax,
originally developed by Crynta. It is maintained independently by
sergewinters and is not affiliated with or endorsed by Crynta.

The agent harness (the "Agent Development" panel and its multi-CLI protocol
adapters) is derived from [MonoCode](https://github.com/hardbeat920/monocode),
originally developed by Nick and distributed under the MIT License. This
attribution does not imply affiliation with or endorsement by its author.

See [NOTICE](NOTICE) for the complete attribution and [LICENSE](LICENSE) for
the applicable Apache-2.0 terms.

## License

Voktty is licensed under the Apache-2.0 License. For more information on our dependencies, see [Apache License 2.0](LICENSE).
