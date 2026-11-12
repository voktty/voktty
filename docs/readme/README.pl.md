<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>Przestrzeń robocza, w której pracują Twoi agenci programistyczni.</strong></p>
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

Voktty to otwartoźródłowa przestrzeń robocza na komputer dla agentów programistycznych AI, zbudowana w Tauri 2, Rust i React 19. Jej Agent Harness uruchamia Claude Code, Codex, Gemini (przez Antigravity), Cursor, Grok, OpenCode, Pi oraz każdy model dostępny przez API, w projektach lokalnych i przez SSH, z zatwierdzaniem, przeglądem zmian, wspólną pamięcią projektu i koordynacją zespołów. Wokół znajdują się natywny terminal, edytor kodu, Git oraz środowiska lokalne, WSL, SSH, Docker, szeregowe i pulpit zdalny. Bez konta i bez telemetrii. Instalatory mają od 25 do 36 MB (v1.0.27; AppImage dla Linuksa około 118 MB).

## Zrzuty ekranu

Zrzuty ekranu pokazują interfejs po hiszpańsku; więcej w [galerii](../screenshots.md).

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness: agent edytuje projekt, a jego zmiany pojawiają się jako diff do zachowania lub cofnięcia" /><br/><sub>Agent Harness: agent edytuje projekt, a jego zmiany pojawiają się jako diff do zachowania lub cofnięcia</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="Projekt SSH: zdalne pliki obok terminala na żywo na serwerze" /><br/><sub>Projekt SSH: zdalne pliki obok terminala na żywo na serwerze</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="Pływający czat AI, który czyta katalog, ostatnie polecenia i wyjście aktywnego terminala" /><br/><sub>Pływający czat AI, który czyta katalog, ostatnie polecenia i wyjście aktywnego terminala</sub>
</p>

## Co dostajesz

### Agenci

- **Wielu agentów w jednym miejscu.** Sesje Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode i Pi obok siebie, każda z własnym CLI i własnym logowaniem.
- **Dowolny model API jako agent.** Dostawcy chmurowi, własne endpointy oraz lokalne modele Ollama, LM Studio i MLX mogą czytać, przeszukiwać, edytować i uruchamiać polecenia w projekcie, z tymi samymi kontrolami obszaru roboczego i ścieżek tajnych co czat AI. Pętla agenta i Twój klucz zostają na Twoim komputerze.
- **Ty decydujesz, na ile im wolno.** Sesje nadzorowane pytają przed każdym zapisem lub poleceniem; pełny dostęp nie pyta. Zmiany pojawiają się jako diffy, które możesz zachować lub cofnąć.
- **Agenci na Twoich serwerach.** W projektach SSH Claude Code, Codex i OpenCode działają na hoście, a przerwane połączenie ich nie zatrzymuje. Modele API czytają, przeszukują i edytują zdalne pliki oraz uruchamiają polecenia, gdy zdalny pomocnik jest aktualny.
- **Zespoły agentów.** Skład z rolami i regułami, tablica pokazująca, kto pracuje lub czeka, orkiestrator, który uruchamia pozostałych i do nich pisze, oraz dziennik tego, co mówią sobie nawzajem i Tobie. Zobacz [przewodnik po zespołach agentów](../guides/agent-teams.md).
- **Pamięć i obecność.** Sprawdzaj i przywracaj to, co agenci pamiętają o projekcie, otrzymuj powiadomienie, gdy agent na dowolnym otwartym hoście na Ciebie czeka, i obserwuj działających agentów w opcjonalnym Notch (alfa).

### Przestrzeń robocza wokół nich

- **Terminal.** Natywny PTY z renderowaniem WebGL, tryby surowy i blokowy, panele, przestrzenie i terminale prywatne.
- **Edytor.** CodeMirror 6 z opcjonalnym LSP, uzupełnianiem i edycją AI, Quick Open oraz wyszukiwaniem i zamianą z podglądem.
- **Git.** Kontrola wersji, historia z grafem commitów, worktree i commity wspomagane przez AI.
- **Środowiska.** Lokalne, WSL, SSH, Docker, szeregowe i RDP, z zapisanymi połączeniami, tunelami i panelem serwera.
- **Podglądy i narzędzia.** Podgląd lokalnych serwerów deweloperskich (także przez SSH), przeglądarki multimediów i PDF, klient API i klient MCP.
- **Towarzysz na telefonie.** Aplikacja na Androida w wersji podglądowej, którą parujesz kodem QR, aby śledzić sesje AI i nimi sterować w sieci lokalnej.

### Domyślnie prywatnie

Bez konta i bez telemetrii Voktty. Klucze dostawców są w systemowym magazynie kluczy, natywny dostęp do systemu plików jest autoryzowany dla każdego obszaru roboczego, narzędzia plikowe AI odrzucają ścieżki tajne, a każde wywołanie narzędzia zmieniającego dane najpierw pyta, chyba że przyznasz pełny dostęp.

Pełna lista funkcji znajduje się w [docs/features.md](../features.md) (po angielsku).

## Instalacja

Najnowsze instalatory znajdują się na stronie [Releases](https://github.com/voktty/voktty/releases/latest). Voktty aktualizuje się stamtąd automatycznie.

### Uwagi dla Windows

- Domyślne wykrywanie powłoki: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL jest pełnoprawnym środowiskiem obszaru roboczego, a nie opakowanym podprocesem.

### Uwagi dla Linux

- **Arch / AUR:** `yay -S voktty-bin` lub `paru`. Pakiet śledzi najnowsze wydanie.
- **NixOS / Nix:** użyj oficjalnego flake. Poza NixOS uruchom `nix profile install github:voktty/voktty`. W NixOS zaimportuj flake i dodaj `inputs.voktty.packages.${pkgs.system}.voktty` do `environment.systemPackages`. Dostępny jest też prostszy moduł `nixosModules.voktty`.
- **AppImage:** wymaga FUSE. Bez niego uruchom `./Voktty_*.AppImage --appimage-extract-and-run`. Przy błędach renderowania w Wayland spróbuj `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Pakiety `.deb` / `.rpm` korzystają z systemowego GTK i zwykle działają płynniej.

## Konfiguracja agentów i AI

1. **Agenci programistyczni.** Zainstaluj CLI agentów, z których korzystasz (na przykład Claude Code lub Codex), i zaloguj się jak zwykle. Voktty je znajduje i używa ich własnego logowania. W projektach SSH zainstaluj je na serwerze.
2. **Modele API.** Otwórz ustawienia i przejdź do **AI Models**, dodaj dostawcę z kluczem lub własny endpoint albo wskaż Voktty lokalny serwer LM Studio, MLX lub Ollama. Modele pojawią się wtedy w wyborze modeli Harness w zakładce **API**.
3. Klucze są zapisywane w systemowym magazynie kluczy przez `keyring` i nigdy w `localStorage`. W Linuksie bez magistrali sesji lub Secret Service Voktty używa prywatnego pliku zapasowego z trybem 0600.

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

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui i Zustand.

## Współtworzenie

Zgłoszenia i PR są mile widziane. Zgłaszaj problemy, proponuj funkcje lub wysyłaj pull requesty. Więcej informacji zawierają [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) i [dokumentacja architektury](../README.md). Kierunek projektu opisuje [mapa drogowa](../../ROADMAP.md).

## Stan podpisywania platform

Obecne kompilacje testowe są tworzone bez podpisu kodu systemu operacyjnego i bez notaryzacji dla Windows i macOS. Windows SmartScreen i macOS Gatekeeper mogą wyświetlać ostrzeżenia, ponieważ instalatory i pakiety aplikacji nie są jeszcze uznawane przez te platformy za zaufane.

Same ostrzeżenia nie potwierdzają obecności złośliwego oprogramowania, ale instaluj wyłącznie kompilacje pobrane z oficjalnych kanałów wydań Voktty po sprawdzeniu sumy kontrolnej lub podpisu wydania. Podpis aktualizatora Voktty jest niezależny od podpisu systemu operacyjnego i chroni autentyczność aktualizacji tylko wtedy, gdy skonfigurowano odpowiedni klucz wydania.

Certyfikaty platform i notaryzacja zostaną dodane przed stabilną dystrybucją.

<br clear="left" />

## Pochodzenie i atrybucja

Voktty jest niezależnym forkiem Terax (Crynta), a jego Agent Harness wywodzi się z MonoCode (MIT, autor Nick). Żaden z autorów nie jest powiązany z Voktty ani go nie popiera. Zobacz [NOTICE](../../NOTICE) i [LICENSE](../../LICENSE).

## Licencja

Voktty jest objęty licencją Apache-2.0. Informacje o zależnościach znajdziesz w [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
