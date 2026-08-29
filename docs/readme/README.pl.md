<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>Lekkie, terminalowe środowisko programistyczne stworzone z myślą o AI.</strong></p>
  <p><a href="https://voktty.dev">Strona</a> · <a href="https://voktty.dev/docs">Dokumentacja</a> · <a href="https://github.com/voktty/voktty">Kod źródłowy strony</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="wersja" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="pobrania" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="platforma" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.pt-BR.md">Português</a> | <a href="README.ru.md">Русский</a> | <a href="README.id.md">Bahasa Indonesia</a> | <a href="README.hi.md">हिन्दी</a>
</p>

---

Voktty to lekkie, otwartoźródłowe, terminalowe środowisko programistyczne (ADE) stworzone z myślą o AI, zbudowane na Tauri 2 + Rust i React 19. Zawiera natywny backend PTY z rendererem WebGL, panel agentowej AI działający z własnymi kluczami lub całkowicie lokalnymi modelami, a także edytor kodu, eksplorator plików, kontrolę źródeł z grafem Git i panel podglądu stron. Około 7-8 MB na dysku. Bez telemetrii. Bez konta.

## Zrzuty ekranu

<table>
  <tr><td align="center"><img src="../images/voktty_6LhZMEZPC6.png" alt="Klient API i sandbox" /><br/><sub>Klient API i sandbox z konstruktorem żądań oraz analizą odpowiedzi</sub></td><td align="center"><img src="../images/voktty_E7ePo9A5ka.png" alt="Historia operacyjna agentów" /><br/><sub>Historia i odzyskiwanie agentów z przeszukiwalnymi sesjami</sub></td></tr>
  <tr><td align="center"><img src="../images/voktty_k5Xr4AqgSA.png" alt="Wybór środowiska" /><br/><sub>Wybór środowisk lokalnych, WSL, SSH, RDP i szeregowych</sub></td><td align="center"><img src="../images/voktty_MAZn6eHFXb.png" alt="Edytor i terminal" /><br/><sub>Edytor kodu, terminal, panel AI i informacje o pliku po najechaniu</sub></td></tr>
  <tr><td colspan="2" align="center"><img src="../images/voktty_vPOlZrpa70.png" alt="Podgląd pliku" /><br/><sub>Podgląd obrazu i metadane pliku w eksploratorze</sub></td></tr>
</table>

## Funkcje

### Terminal

- xterm.js z rendererem WebGL, wieloma kartami i strumieniowaniem w tle
- Akcelerowany przez GPU terminal blokowy z wprowadzaniem poleceń jak w edytorze
- Natywny backend PTY przez `portable-pty` (zsh, bash, pwsh, fish, cmd)
- Panele dzielone poziomo i pionowo
- Wyszukiwanie w wierszu, wykrywanie linków i pełna paleta kolorów
- Przeciąganie plików z eksploratora lub pulpitu jako bezpiecznie cytowanych ścieżek powłoki
- Środowiska obszaru roboczego na kartę w Windows (Local lub dowolna dystrybucja WSL)
- Spaces przywraca karty, katalogi robocze i układy paneli między uruchomieniami

### Edytor kodu

- CodeMirror 6 obsługujący popularne języki, w tym TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON i Markdown
- Uzupełnianie kodu przez AI z obsługą modeli lokalnych
- Różnice zmian AI akceptowane lub odrzucane fragment po fragmencie
- Opcjonalne serwery językowe z diagnostyką, nawigacją, uzupełnianiem, formatowaniem i własnymi serwerami
- Renderowany Markdown oraz podgląd obrazów, wideo, audio i PDF
- Tryb Vim
- Wbudowane motywy, między innymi Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub i Xcode

### Kontrola źródeł

- Dodawanie i usuwanie fragmentów ze stage, commit (Cmd+Enter / Ctrl+Enter) i push ze świadomością upstreamu
- Widok gałęzi, także w stanie detached HEAD
- Historia Git z prawdziwym grafem commitów i torami dla scaleń oraz gałęzi
- Wyszukiwanie i filtrowanie commitów oraz otwieranie ich stron zdalnych

### Eksplorator plików

- Motyw ikon Catppuccin
- Wyszukiwanie rozmyte, nawigacja klawiaturą, zmiana nazwy w miejscu i akcje kontekstowe
- Aktualizacja na żywo po zmianie plików na dysku
- Dołączanie plików i zaznaczeń bezpośrednio do panelu AI

### Podgląd stron

- Automatyczne wykrywanie lokalnych serwerów i otwieranie ich na karcie podglądu
- Podgląd zewnętrznych URL w natywnym podrzędnym WebView

### Motywy i personalizacja

- Tworzenie motywów w aplikacji i przełączanie między ustawieniami a własnymi motywami
- Udostępnianie motywów lub importowanie ich od społeczności
- Obrazy tła z regulowaną przezroczystością i rozmyciem
- Motyw edytora jest niezależny od motywu aplikacji

### AI

- **Dostawcy z własnym kluczem:** OpenAI, Anthropic, Google (Gemini), Groq, xAI (Grok), Cerebras, OpenRouter, DeepSeek, Mistral i dowolny endpoint zgodny z OpenAI
- **Lokalnie / offline:** LM Studio, MLX, Ollama
- **Agentowy przepływ pracy:** plany, podagenci, pamięć projektu przez `VOKTTY.md`, odczyt / zapis / edycja / wielokrotna edycja / grep / glob, bash wymagający zgody i procesy w tle
- **Orkiestracja agentów programistycznych:** uruchom Claude Code w terminalu, sprawdź wynik i wysyłaj dalsze zadania przez narzędzia wymagające zgody
- **Pole wprowadzania:** fragmenty promptów przez `#handle`, pliki przez `@path`, wejście głosowe i załączniki z eksploratora lub zaznaczenia
- **Własne agenty** z osobnym promptem systemowym i zestawem narzędzi
- **Tryb planowania**, który tworzy plan i prosi o potwierdzenie przed działaniem

## Aktualne nowości w Voktty

- **Płaskie przestrzenie złożone:** niezależne karty pozostają oddzielone od nazwanych Spaces. Ich elementy można deterministycznie porządkować, korzystając z 2, 4, 6 lub 8 widoków bez zagnieżdżonych Spaces.
- **IDE i debugowanie:** CodeMirror 6, nawigacja po symbolach, panel Problems, akcje kodu, podpowiedzi Ghost, zmiany weryfikowane jako diff oraz debugowanie DAP po skonfigurowaniu odpowiedniego adaptera.
- **Bezpieczny klient MCP:** połącz lokalne serwery stdio lub zdalne serwery Streamable HTTP. Narzędzia są walidowane, a mutacje wymagają natywnej jednorazowej zgody.
- **Natywne rozszerzenia:** rozszerzenia JavaScript z `~/.voktty/extensions/` mogą dodawać polecenia, skróty, narzędzia AI, powiadomienia i akcje workspace. To API Voktty, a nie zgodność z rozszerzeniami VS Code.
- **Współpraca w terminalu:** tymczasowo udostępniaj terminal z rolami obserwatora i kontrolera, dodatkowym szyfrowaniem oraz zdalnymi cytowaniami plików tylko do odczytu.
- **Połączenia i wydajność:** środowiska Local, WSL, SSH, Docker i szeregowe pokazują cykl połączenia; ukryte terminale zwalniają kosztowne renderery bez zatrzymywania aktywnych procesów.
- **Obecność agentów:** awatary według roli, animowane ikony agentów zewnętrznych i opcjonalne lokalne dźwięki zapisu, Git, Problems, debugowania oraz odpowiedzi agenta, z obsługą ograniczenia ruchu.

Pełna i kanoniczna lista funkcji znajduje się w [README po angielsku](../../README.md), wraz z ograniczeniami bezpieczeństwa i dostępnością dla platform.

## Instalacja

Najnowsze instalatory znajdują się na stronie [Releases](https://github.com/voktty/voktty/releases/latest). Voktty aktualizuje się stamtąd automatycznie.

### Uwagi dla Windows

- Domyślne wykrywanie powłoki: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL jest pełnoprawnym środowiskiem obszaru roboczego, a nie opakowanym podprocesem.

### Uwagi dla Linux

- **Arch / AUR:** `yay -S voktty-bin` lub `paru`. Pakiet śledzi najnowsze wydanie.
- **NixOS / Nix:** użyj oficjalnego flake. Poza NixOS uruchom `nix profile install github:voktty/voktty`. W NixOS zaimportuj flake i dodaj `inputs.voktty.packages.${pkgs.system}.voktty` do `environment.systemPackages`. Dostępny jest też prostszy moduł `nixosModules.voktty`.
- **AppImage:** wymaga FUSE. Bez niego uruchom `./Voktty_*.AppImage --appimage-extract-and-run`. Przy błędach renderowania w Wayland spróbuj `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Pakiety `.deb` / `.rpm` korzystają z systemowego GTK i zwykle działają płynniej.

## Konfiguracja AI

1. Otwórz **Ustawienia -> AI**.
2. Wybierz dostawcę i wklej klucz API. Dla lokalnego wnioskowania wskaż endpoint LM Studio / MLX / Ollama.
3. Klucze trafiają do systemowego pęku kluczy przez `keyring`. Nigdy nie są zapisywane na dysku ani w localStorage.

## Budowanie ze źródeł

**Wymagania**

- Rust (stable), https://rustup.rs
- Node 20+ i [pnpm](https://pnpm.io)
- Wymagania Tauri dla platformy, https://tauri.app/start/prerequisites/

**Uruchamianie**

```bash
pnpm install
pnpm tauri dev          # środowisko deweloperskie
pnpm tauri build        # pakiet produkcyjny
```

**Kontrole**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # lint Rust zgodny z CI
cd src-tauri && cargo nextest run --locked                           # lub cargo test --locked
```

## Stos technologiczny

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK v6, Tailwind v4, shadcn/ui i Zustand.

## Współtworzenie

Zgłoszenia i PR są mile widziane. Zgłaszaj problemy, proponuj funkcje lub wysyłaj pull requesty. Więcej informacji zawierają [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) i [dokumentacja architektury](../README.md).

## Stan podpisywania platform

Obecne kompilacje testowe są tworzone bez podpisu kodu systemu operacyjnego i bez notaryzacji dla Windows i macOS. Windows SmartScreen i macOS Gatekeeper mogą wyświetlać ostrzeżenia, ponieważ instalatory i pakiety aplikacji nie są jeszcze uznawane przez te platformy za zaufane.

Same ostrzeżenia nie potwierdzają obecności złośliwego oprogramowania, ale instaluj wyłącznie kompilacje pobrane z oficjalnych kanałów wydań Voktty po sprawdzeniu sumy kontrolnej lub podpisu wydania. Podpis aktualizatora Voktty jest niezależny od podpisu systemu operacyjnego i chroni autentyczność aktualizacji tylko wtedy, gdy skonfigurowano odpowiedni klucz wydania.

Certyfikaty platform i notaryzacja zostaną dodane przed stabilną dystrybucją.

<br clear="left" />

## Licencja

Voktty jest objęty licencją Apache-2.0. Informacje o zależnościach znajdziesz w [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
