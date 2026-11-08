# Voktty 1.0.20 Release Notes

Voktty 1.0.20 introduces integrated web and PHP project previews over secure SSH tunnels, a completely unified settings center, intuitive drag-and-drop workspace tab splitting, advanced SSH proxy and authentication controls, expanded configuration file and character encoding compatibility, full English and Spanish internationalization across the Harness, and fine-grained AI provider rate-limit tracking.

---

### Web & Remote Development Previews

- **Status Bar Project Preview**: Quickly launch and inspect web projects directly from a dedicated status bar button.
- **Built-in PHP Development Server**: Seamlessly serve PHP web applications with automatic static asset delivery, valid HTTP headers, and embedded live inspector tools.
- **Remote Previews via SSH Tunneling**: Preview web projects hosted on remote SSH servers through an automatic, secure local tunnel.
- **Live Reload & Source Navigation**: Automatic preview reload upon saving remote files, with one-click jumping to the corresponding remote source line.

---

### Workspace, Tabs & Window Navigation

- **Drag-to-Split Workspace Tabs**: Drag any tab over the current active view to instantly split the pane and create a new workspace view without disrupting your layout.
- **Window Dragging from Title Bar**: Smooth, native window movement when clicking and dragging empty areas in the top bar.
- **Double-Click for New Terminal**: Quickly open a new terminal tab by double-clicking empty space in the title bar (equivalent to `Ctrl+T`).
- **Clean Project Rail**: Permanently dismiss inactive or stale projects; discarded projects no longer reappear after external history synchronizations.
- **Unreachable & Missing Directory Indicators**: Immediate visual status badges for offline SSH connections or moved/missing project folders.

---

### Unified Settings & Streamlined UI

- **Consolidated Settings Center**: Eliminated disjointed configuration menus; all application, agent, and workspace settings now live in a single unified dialog.
- **New Settings Sections**: Dedicated tabs for **Agents & Chat**, **Integrations**, and **Projects** alongside streamlined Themes and Shortcuts.
- **Automations & Project Memory in Status Bar**: Moved secondary Harness controls into lightweight status bar popovers, maximizing productive screen space.

---

### SSH Connections & Proxy Support

- **Native Proxy Protocols**: Built-in client support for HTTP CONNECT, SOCKS5 (RFC 1928/1929 with username/password authentication), and SOCKS4/4a proxies.
- **Zero-Dependency ProxyCommand**: Built-in `voktty ssh-proxy` command routes OpenSSH and SFTP connections through corporate proxies without requiring external tools (`nc` or `connect.exe`).
- **Granular Authentication Methods**: Select between Automatic, Password, Public Key, or Interactive authentication with integrated show/hide password and passphrase toggles.

---

### Editor & Extended File Compatibility

- **Multi-Encoding Character Support**: Native decoding for UTF-8 (with and without BOM), UTF-16 LE/BE, and ANSI / Windows-1252 / ISO-8859-1 for international characters (`ñ`, `á`, `€`, etc.).
- **Expanded Configuration Formats**: Added syntax highlighting and native file associations for `.ini`, `.cfg`, `.conf`, `.inf`, `.reg`, `.gitconfig`, and `.npmrc`.
- **Force Open Large Files**: New "Open Anyway" action for opening large configuration or log files up to 50 MB as text.

---

### AI Harness & Provider Improvements

- **Full Harness Internationalization (i18n)**: 100% complete localization in English and Spanish across all Harness dialogs, buttons, prompts, and status messages.
- **Provider Quota Insights**: Real-time inspection of multi-bucket rate limits for OpenAI Codex and automatic tracking of Claude's tightest weekly usage window.
- **Project-Scoped Memory**: Agent context and project memory are strictly isolated to their active workspace repository for enhanced privacy and consistency.

---

### Terminal & System Reliability

- **Docker Tab & Container Integration**: Reliable PTY command execution and canonical tab lifecycle for Docker containers.
- **Enhanced PTY Responsiveness**: Traced input and resize pipelines to prevent terminal lag and UI freezes during heavy output.
- **Cross-Platform Stability**: Hardened native filesystem and network bindings across Linux and Windows environments.

---

### Upgrade Notes

- All existing tabs, spaces, SSH configurations, agent history, and custom keybindings remain fully compatible with version 1.0.20.
