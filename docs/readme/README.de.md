<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>

  <p><strong>Leichtgewichtiger, terminalorientierter und KI-nativer Entwicklungsarbeitsbereich.</strong></p>

  <p>
    <a href="https://voktty.dev">Website</a> ·
    <a href="https://voktty.dev/docs">Dokumentation</a> ·
    <a href="https://github.com/voktty/voktty">Quellcode der Website</a>
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="Version" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="Downloads" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="Plattform" />
    <a href="https://discord.gg/tyveTUyEp7"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

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

Voktty ist eine leichtgewichtige, quelloffene, terminalorientierte und KI-native Entwicklungsumgebung (ADE), die auf Tauri 2 + Rust und React 19 basiert. Sie bietet ein natives PTY-Backend mit WebGL-Renderer, eine agentische KI-Seitenleiste für eigene Schlüssel oder vollständig lokale Modelle sowie einen Code-Editor, Datei-Explorer, Quellcodeverwaltung mit Git-Graph und eine integrierte Webvorschau. Etwa 7-8 MB auf der Festplatte. Keine Telemetrie. Kein Konto.

## Screenshots

<table>
  <tr>
    <td align="center"><img src="../images/voktty_0stHyTBbyY.png" alt="Arbeitsbereich" /><br/><sub>Voktty-Arbeitsbereich mit Dateien und Tabs</sub></td>
    <td align="center"><img src="../images/voktty_ljubKqX22C.png" alt="Terminal-Copilot" /><br/><sub>Terminal-Copilot mit natürlicher Sprache</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="../images/voktty_kLd3UCiAji.png" alt="Themes" style="margin-top: 12px;"/><br/><sub>Eigene Themes und Voreinstellungen</sub></td>
    <td align="center"><img src="../images/voktty_kiAdbgrGGj.png" alt="Quellcodeverwaltung und Git-Graph" style="margin-top: 12px;"/><br/><sub>Quellcodeverwaltung mit Git-Graph</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="../images/voktty_wiRVOca2A5.png" alt="Terminal" style="border-radius: 4px; margin-top: 12px;" /><br/><sub>Terminal mit Systeminformationen und Arbeitsbereich</sub></td>
  </tr>
</table>

## Funktionen

### Terminal

- xterm.js mit WebGL-Renderer, mehreren Tabs und Hintergrund-Streaming
- GPU-beschleunigtes blockbasiertes Terminal mit editorähnlicher Befehlseingabe
- Natives PTY-Backend über `portable-pty` (zsh, bash, pwsh, fish, cmd)
- Horizontal und vertikal geteilte Bereiche
- Integrierte Suche, Linkerkennung und True Color
- Dateien aus Explorer oder Desktop als Shell-sicher quotierte Pfade in ein Terminal ziehen
- Arbeitsumgebungen pro Tab unter Windows (Lokal oder jede installierte WSL-Distribution)
- Spaces stellt Tabs, Arbeitsverzeichnisse und geteilte Layouts nach einem Neustart wieder her

### Code-Editor

- CodeMirror 6 (unterstützt alle verbreiteten Sprachen wie TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, Markdown usw.)
- Integrierte KI-Vervollständigung mit Unterstützung lokaler Modelle
- KI-Bearbeitungs-Diffs, abschnittsweise annehmbar oder ablehnbar
- Optionale Language-Server-Unterstützung mit Diagnosen, Navigation, Vervollständigung, Formatierung und eigenen Servern
- Gerendertes Markdown sowie Anzeige von Bildern, Videos, Audio und PDF
- Vim-Modus
- Integrierte Editor-Themes wie Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub und Xcode

### Quellcodeverwaltung

- Abschnitte stagen oder unstagen, committen (Cmd+Enter / Ctrl+Enter) und mit Upstream-Erkennung pushen
- Branch-Anzeige einschließlich Detached-HEAD-Zustand
- Git-Verlauf mit echtem Commit-Graphen und Spuren für Merges und Branches
- Commits suchen und filtern sowie die Remote-Commit-Seite öffnen

### Datei-Explorer

- Catppuccin-Icon-Theme
- Unscharfe Suche, Tastaturnavigation, direktes Umbenennen und Kontextaktionen
- Live-Aktualisierung bei Dateiänderungen auf der Festplatte
- Dateien und Auswahl direkt an die KI-Seitenleiste anhängen

### Webvorschau

- Erkennt lokale Entwicklungsserver automatisch und öffnet sie in einem Vorschau-Tab
- Vorschau externer URLs über eine native untergeordnete Webview

### Themes und Anpassung

- Eigene Themes in der App erstellen und zwischen integrierten Vorgaben und eigenen Themes wechseln
- Themes teilen oder aus der Community importieren
- Hintergrundbilder mit einstellbarer Deckkraft und Unschärfe
- Das Editor-Theme ist unabhängig vom App-Theme

### KI

- **Anbieter mit eigenem Schlüssel:** OpenAI, Anthropic, Google (Gemini), Groq, xAI (Grok), Cerebras, OpenRouter, DeepSeek, Mistral sowie jeder OpenAI-kompatible Endpunkt
- **Lokal / offline:** LM Studio, MLX, Ollama
- **Agentischer Workflow:** Pläne, Sub-Agenten, Projektgedächtnis über `VOKTTY.md`, Lesen / Schreiben / Bearbeiten / Mehrfachbearbeitung / grep / glob, Bash mit Freigabe und Hintergrundprozesse
- **Orchestrierung von Coding-Agenten:** Claude Code in einem Terminal starten, Ausgabe prüfen und Folgeaufgaben über freigabepflichtige Tools senden
- **Composer:** Prompt-Snippets über `#handle`, Dateien über `@path`, Spracheingabe und Anhängen aus Explorer oder Auswahl
- **Eigene Agenten** mit eigenem System-Prompt und Tool-Teilsatz
- **Planungsmodus**, der vor der Ausführung einen Plan erstellt und bestätigen lässt

## Aktuelle Neuerungen in Voktty

- **Flache zusammengesetzte Spaces:** Einzelne Tabs bleiben von benannten Spaces getrennt. Mitglieder lassen sich deterministisch neu anordnen; verschachtelte Spaces und unbegrenzte Ansichten werden verhindert. Verfügbar sind 2, 4, 6 oder 8 Ansichten.
- **IDE und Debugging:** CodeMirror 6, Symbolnavigation, Problems-Panel, Code Actions, Ghost-Completion, überprüfbare Diff-Änderungen und DAP-Debugging, wenn ein passender Adapter eingerichtet ist.
- **Sicherer MCP-Client:** Lokale stdio-Server und entfernte Streamable-HTTP-Server können verbunden werden. Tools werden validiert; Änderungen benötigen eine native einmalige Freigabe.
- **Native Erweiterungen:** JavaScript-Erweiterungen aus `~/.voktty/extensions/` können Befehle, Tastenkürzel, KI-Tools, Benachrichtigungen und Workspace-Aktionen beitragen. Dies ist eine Voktty-API und keine Kompatibilität mit VS-Code-Erweiterungen.
- **Terminal-Kollaboration:** Eine Terminal-Sitzung kann vorübergehend mit Beobachter- und Steuerungsrollen, zusätzlicher Verschlüsselung und schreibgeschützten entfernten Dateizitaten geteilt werden.
- **Verbindungen und Leistung:** Lokale Umgebungen, WSL, SSH, Docker und serielle Verbindungen zeigen ihren Verbindungsstatus; ausgeblendete Terminals geben teure Renderer frei, ohne aktive Prozesse zu stoppen.
- **Agentenpräsenz:** Rollenbasierte Avatare, animierte Symbole für externe Agenten und optionale lokale Sounds für Speichern, Git, Problems, Debugging und Agentenantworten unterstützen reduzierte Bewegung.

Die vollständige und kanonische Funktionsliste steht im [englischen README](../../README.md), einschließlich Sicherheitsgrenzen und plattformspezifischer Verfügbarkeit.

## Installation

Die neuesten Installationspakete stehen auf der Seite [Releases](https://github.com/voktty/voktty/releases/latest). Voktty aktualisiert sich von dort automatisch.

### Hinweise für Windows

- Standardmäßige Shell-Erkennung: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL ist eine vollwertige Arbeitsumgebung und kein umschlossener Unterprozess.

### Hinweise für Linux

- **Arch / AUR:** `yay -S voktty-bin` (oder `paru` usw.). Folgt der neuesten Version.
- **NixOS / Nix:** Nutze den offiziellen Flake: `nix profile install github:voktty/voktty` außerhalb von NixOS. Unter NixOS importierst du den Flake und fügst `inputs.voktty.packages.${pkgs.system}.voktty` zu `environment.systemPackages` hinzu. Für eine einfachere Einrichtung ist auch `nixosModules.voktty` verfügbar.
- **AppImage:** Benötigt FUSE. Ohne FUSE: `./Voktty_*.AppImage --appimage-extract-and-run`. Bei Darstellungsfehlern unter Wayland hilft möglicherweise `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Die `.deb`- / `.rpm`-Pakete binden stattdessen den GTK-Stack des Systems ein und laufen meist flüssiger.

## KI konfigurieren

1. Öffne **Einstellungen -> KI**.
2. Wähle einen Anbieter und füge deinen API-Schlüssel ein. Für lokale Inferenz verweist du Voktty auf deinen LM Studio- / MLX- / Ollama-Endpunkt.
3. Schlüssel werden über `keyring` im Schlüsselbund des Betriebssystems gespeichert. Sie werden niemals auf die Festplatte oder in localStorage geschrieben.

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

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK v6, Tailwind v4, shadcn/ui und Zustand.

## Mitwirken

Issues und PRs sind willkommen. Melde Probleme, schlage Funktionen vor oder reiche Pull Requests ein. Weitere Informationen findest du in [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) und der [Architekturdokumentation](../README.md).

## Status der Plattform-Signierung

Die aktuellen Vorschau-Builds werden für Windows und macOS ohne Betriebssystem-Code-Signatur und Notarisierung erstellt. Windows SmartScreen und macOS Gatekeeper können Warnungen anzeigen, weil die Installer und App-Bundles von diesen Plattformen noch nicht als vertrauenswürdig erkannt werden.

Diese Warnungen beweisen für sich allein keine Malware. Installiere jedoch nur Builds aus den offiziellen Voktty-Release-Kanälen und prüfe vorher deren Checksumme oder Release-Signatur. Die Voktty-Updater-Signatur ist von der Betriebssystem-Signatur unabhängig und schützt die Authentizität von Updates nur, wenn der entsprechende Release-Schlüssel konfiguriert ist.

Plattformzertifikate und Notarisierung werden vor der stabilen Veröffentlichung ergänzt.

<br clear="left" />

## Lizenz

Voktty steht unter der Apache-2.0-Lizenz. Weitere Informationen zu unseren Abhängigkeiten findest du in der [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
