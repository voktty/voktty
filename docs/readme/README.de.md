<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>

  <p><strong>Der Arbeitsplatz, an dem deine Coding-Agenten arbeiten.</strong></p>

  <p>
    <a href="https://voktty.dev">Website</a> ·
    <a href="https://voktty.dev/docs">Dokumentation</a> ·
    <a href="https://github.com/voktty/voktty">Quellcode der Website</a>
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="Version" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="Downloads" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="Plattform" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.es.md">Español</a> |
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

Voktty ist ein quelloffener Desktop-Arbeitsplatz für KI-Coding-Agenten, gebaut mit Tauri 2, Rust und React 19. Das Agent Harness führt Claude Code, Codex, Gemini (über Antigravity), Cursor, Grok, OpenCode, Pi und jedes Modell aus, das du per API erreichst, in lokalen und SSH-Projekten aus, mit Freigaben, Änderungsprüfung, gemeinsamem Projektgedächtnis und Team-Koordination. Darum herum gibt es ein natives Terminal, einen Code-Editor, Git sowie lokale, WSL-, SSH-, Docker-, serielle und Remote-Desktop-Umgebungen. Kein Konto, keine Telemetrie. Die Installer sind 25 bis 36 MB groß (v1.0.27; das Linux-AppImage etwa 118 MB).

## Screenshots

Die Aufnahmen zeigen eine spanische Oberfläche; weitere findest du in der [Galerie](../screenshots.md).

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness: Ein Agent bearbeitet ein Projekt, seine Änderungen erscheinen als Diff zum Behalten oder Rückgängigmachen" /><br/><sub>Agent Harness: Ein Agent bearbeitet ein Projekt, seine Änderungen erscheinen als Diff zum Behalten oder Rückgängigmachen</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="SSH-Projekt: Remote-Dateien neben einem Live-Terminal auf dem Server" /><br/><sub>SSH-Projekt: Remote-Dateien neben einem Live-Terminal auf dem Server</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="Schwebender KI-Chat, der Verzeichnis, letzte Befehle und Ausgabe des aktiven Terminals liest" /><br/><sub>Schwebender KI-Chat, der Verzeichnis, letzte Befehle und Ausgabe des aktiven Terminals liest</sub>
</p>

## Das bekommst du

### Agenten

- **Viele Agenten, ein Ort.** Sitzungen für Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode und Pi nebeneinander, jede mit ihrer eigenen CLI und ihrem eigenen Login.
- **Jedes API-Modell als Agent.** Cloud-Anbieter, eigene Endpunkte sowie lokale Ollama-, LM-Studio- oder MLX-Modelle können in einem Projekt lesen, suchen, bearbeiten und Befehle ausführen, mit denselben Workspace- und Geheimpfad-Prüfungen wie der KI-Chat. Die Agentenschleife und dein Schlüssel bleiben auf deinem Rechner.
- **Du bestimmst, wie viel sie dürfen.** Überwachte Sitzungen fragen vor jedem Schreibzugriff und jedem Befehl; bei vollem Zugriff nicht. Änderungen erscheinen als Diffs, die du behalten oder rückgängig machen kannst.
- **Agenten auf deinen Servern.** In SSH-Projekten laufen Claude Code, Codex und OpenCode auf dem Host, und eine abgebrochene Verbindung stoppt sie nicht. API-Modelle lesen, durchsuchen und bearbeiten Remote-Dateien und führen Befehle aus, wenn der Remote-Helper aktuell ist.
- **Agenten-Teams.** Ein Roster mit Rollen und Regeln, ein Board, wer arbeitet oder wartet, ein Orchestrator, der die anderen startet und anschreibt, und ein Protokoll dessen, was sie einander und dir mitteilen. Siehe den [Leitfaden zu Agenten-Teams](../guides/agent-teams.md).
- **Gedächtnis und Präsenz.** Prüfe und stelle wieder her, was Agenten über ein Projekt wissen, werde benachrichtigt, wenn ein Agent auf einem offenen Host auf dich wartet, und beobachte laufende Agenten im optionalen Notch (Alpha).

### Der Arbeitsplatz drumherum

- **Terminal.** Natives PTY mit WebGL-Rendering, Raw- und Blockmodus, Panes, Spaces und private Terminals.
- **Editor.** CodeMirror 6 mit optionalem LSP, KI-Vervollständigung und -Bearbeitung, Quick Open sowie Suchen und Ersetzen mit Vorschau.
- **Git.** Versionskontrolle, Verlauf mit Commit-Graph, Worktrees und KI-gestützte Commits.
- **Umgebungen.** Lokal, WSL, SSH, Docker, seriell und RDP, mit gespeicherten Verbindungen, Tunneln und einem Server-Dashboard.
- **Vorschauen und Werkzeuge.** Vorschau lokaler Entwicklungsserver (auch über SSH), Medien- und PDF-Viewer, ein API-Client und ein MCP-Client.
- **Begleiter am Telefon.** Eine Android-App in der Vorschau, die sich per QR-Code koppelt, um KI-Sitzungen über dein lokales Netzwerk zu verfolgen und zu steuern.

### Standardmäßig privat

Kein Konto und keine Voktty-Telemetrie. Anbieter-Schlüssel liegen im Schlüsselbund des Betriebssystems, nativer Dateisystemzugriff wird pro Workspace autorisiert, die KI-Dateiwerkzeuge verweigern geheime Pfade, und jeder ändernde Werkzeugaufruf fragt zuerst, sofern du keinen vollen Zugriff gewährst.

Die vollständige Funktionsliste steht in [docs/features.md](../features.md) (auf Englisch).

## Installation

Die neuesten Installationspakete stehen auf der Seite [Releases](https://github.com/voktty/voktty/releases/latest). Voktty aktualisiert sich von dort automatisch.

### Hinweise für Windows

- Standardmäßige Shell-Erkennung: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL ist eine vollwertige Arbeitsumgebung und kein umschlossener Unterprozess.

### Hinweise für Linux

- **Arch / AUR:** `yay -S voktty-bin` (oder `paru` usw.). Folgt der neuesten Version.
- **NixOS / Nix:** Nutze den offiziellen Flake: `nix profile install github:voktty/voktty` außerhalb von NixOS. Unter NixOS importierst du den Flake und fügst `inputs.voktty.packages.${pkgs.system}.voktty` zu `environment.systemPackages` hinzu. Für eine einfachere Einrichtung ist auch `nixosModules.voktty` verfügbar.
- **AppImage:** Benötigt FUSE. Ohne FUSE: `./Voktty_*.AppImage --appimage-extract-and-run`. Bei Darstellungsfehlern unter Wayland hilft möglicherweise `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Die `.deb`- / `.rpm`-Pakete binden stattdessen den GTK-Stack des Systems ein und laufen meist flüssiger.

## Agenten und KI einrichten

1. **Coding-Agenten.** Installiere die Agenten-CLIs, die du nutzt (zum Beispiel Claude Code oder Codex), und melde dich wie gewohnt an. Voktty findet sie und nutzt ihren eigenen Login. Für SSH-Projekte installierst du sie auf dem Server.
2. **API-Modelle.** Öffne die Einstellungen und gehe zu **KI-Modelle**, füge einen Anbieter mit Schlüssel oder einen eigenen Endpunkt hinzu oder richte Voktty auf einen lokalen LM-Studio-, MLX- oder Ollama-Server. Die Modelle erscheinen dann in der Harness-Modellauswahl unter **API**.
3. Schlüssel werden über `keyring` im Schlüsselbund des Betriebssystems gespeichert, nie in `localStorage`. Unter Linux ohne Session-Bus oder Secret Service nutzt Voktty eine private Ausweichdatei mit Modus 0600.

## Aus dem Quellcode bauen

**Voraussetzungen**

- Rust (stable), https://rustup.rs
- Node 20+ und [pnpm](https://pnpm.io)
- Tauri-Voraussetzungen für deine Plattform, https://tauri.app/start/prerequisites/

**Ausführen**

```bash
pnpm install
pnpm tauri dev          # Entwicklung
pnpm tauri build        # Produktionspaket
```

**Prüfungen**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # Rust-Lint wie in CI
cd src-tauri && cargo nextest run --locked                           # oder: cargo test --locked
```

## Technologie-Stack

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui und Zustand.

## Mitwirken

Issues und PRs sind willkommen. Melde Probleme, schlage Funktionen vor oder reiche Pull Requests ein. Weitere Informationen findest du in [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) und der [Architekturdokumentation](../README.md). Die Richtung des Projekts steht in der [Roadmap](../../ROADMAP.md).

## Status der Plattform-Signierung

Die aktuellen Vorschau-Builds werden für Windows und macOS ohne Betriebssystem-Code-Signatur und Notarisierung erstellt. Windows SmartScreen und macOS Gatekeeper können Warnungen anzeigen, weil die Installer und App-Bundles von diesen Plattformen noch nicht als vertrauenswürdig erkannt werden.

Diese Warnungen beweisen für sich allein keine Malware. Installiere jedoch nur Builds aus den offiziellen Voktty-Release-Kanälen und prüfe vorher deren Checksumme oder Release-Signatur. Die Voktty-Updater-Signatur ist von der Betriebssystem-Signatur unabhängig und schützt die Authentizität von Updates nur, wenn der entsprechende Release-Schlüssel konfiguriert ist.

Plattformzertifikate und Notarisierung werden vor der stabilen Veröffentlichung ergänzt.

<br clear="left" />

## Herkunft und Namensnennung

Voktty ist ein unabhängiger Fork von Terax (Crynta), und sein Agent Harness leitet sich von MonoCode (MIT, von Nick) ab. Keiner der Autoren ist mit Voktty verbunden oder unterstützt es. Siehe [NOTICE](../../NOTICE) und [LICENSE](../../LICENSE).

## Lizenz

Voktty steht unter der Apache-2.0-Lizenz. Weitere Informationen zu unseren Abhängigkeiten findest du in der [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
