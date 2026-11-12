<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>코딩 에이전트가 일하는 워크스페이스.</strong></p>
  <p><a href="https://voktty.dev">웹사이트</a> · <a href="https://voktty.dev/docs">문서</a> · <a href="https://github.com/voktty/voktty">웹사이트 소스 코드</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="버전" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="다운로드" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="플랫폼" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.id.md">Bahasa Indonesia</a> | <a href="README.hi.md">हिन्दी</a>
</p>

---

Voktty는 AI 코딩 에이전트를 위한 오픈 소스 데스크톱 워크스페이스로, Tauri 2, Rust, React 19로 만들어졌습니다. Agent Harness는 Claude Code, Codex, Gemini(Antigravity 경유), Cursor, Grok, OpenCode, Pi, 그리고 API로 접근하는 모든 모델을 로컬 및 SSH 프로젝트에서 실행하며, 승인, 변경 검토, 공유 프로젝트 메모리, 팀 협업을 제공합니다. 주변에는 네이티브 터미널, 코드 편집기, Git, 그리고 로컬, WSL, SSH, Docker, 시리얼, 원격 데스크톱 환경이 있습니다. 계정 불필요, 텔레메트리 없음. 설치 파일 크기는 25~36 MB입니다(v1.0.27, Linux AppImage는 약 118 MB).

## 스크린샷

스크린샷은 스페인어 인터페이스를 사용합니다. 더 많은 이미지는 [갤러리](../screenshots.md)에서 볼 수 있습니다.

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness: 에이전트가 프로젝트를 편집하면 변경 사항이 유지하거나 되돌릴 수 있는 diff로 표시됩니다" /><br/><sub>Agent Harness: 에이전트가 프로젝트를 편집하면 변경 사항이 유지하거나 되돌릴 수 있는 diff로 표시됩니다</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="SSH 프로젝트: 원격 파일과 서버의 실시간 터미널을 나란히 표시" /><br/><sub>SSH 프로젝트: 원격 파일과 서버의 실시간 터미널을 나란히 표시</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="활성 터미널의 디렉터리, 최근 명령, 출력을 읽는 플로팅 AI 채팅" /><br/><sub>활성 터미널의 디렉터리, 최근 명령, 출력을 읽는 플로팅 AI 채팅</sub>
</p>

## 제공하는 기능

### 에이전트

- **여러 에이전트를 한곳에서.** Claude Code, Codex, Antigravity(Gemini), Cursor, Grok, OpenCode, Pi 세션을 나란히 실행하며, 각각 자체 CLI와 로그인을 사용합니다.
- **모든 API 모델을 에이전트로.** 클라우드 제공업체, 사용자 지정 엔드포인트, 로컬 Ollama, LM Studio, MLX 모델이 AI 채팅과 같은 워크스페이스 및 비밀 경로 검사를 거쳐 프로젝트에서 읽고, 검색하고, 편집하고, 명령을 실행할 수 있습니다. 에이전트 루프와 키는 내 컴퓨터에 남습니다.
- **어디까지 허용할지는 직접 정합니다.** 감독 세션은 쓰기나 명령 전에 매번 묻고, 전체 액세스는 묻지 않습니다. 편집 내용은 유지하거나 되돌릴 수 있는 diff로 표시됩니다.
- **내 서버의 에이전트.** SSH 프로젝트에서는 Claude Code, Codex, OpenCode가 호스트에서 실행되며 연결이 끊겨도 멈추지 않습니다. API 모델은 원격 파일을 읽고, 검색하고, 편집하며, 원격 헬퍼가 최신이면 명령도 실행합니다.
- **에이전트 팀.** 역할과 규칙이 있는 명단, 누가 작업 중이거나 대기 중인지 보여 주는 보드, 다른 에이전트를 시작하고 메시지를 보내는 오케스트레이터, 그리고 서로와 사용자에게 한 말의 기록. [에이전트 팀 가이드](../guides/agent-teams.md)를 참고하세요.
- **메모리와 상태 표시.** 에이전트가 프로젝트에 대해 기억하는 내용을 확인하고 복원하며, 열려 있는 어느 호스트에서든 에이전트가 사용자를 기다리면 알림을 받고, 선택 사항인 Notch(알파)에서 실행 중인 에이전트를 볼 수 있습니다.

### 그 주변의 워크스페이스

- **터미널.** WebGL 렌더링을 사용하는 네이티브 PTY, 원시 및 블록 모드, 패널, 스페이스, 비공개 터미널.
- **편집기.** CodeMirror 6, 선택형 LSP, AI 자동 완성과 편집, Quick Open, 미리 보기 중심의 검색 및 바꾸기.
- **Git.** 소스 제어, 커밋 그래프가 있는 기록, worktree, AI 지원 커밋.
- **환경.** 로컬, WSL, SSH, Docker, 시리얼, RDP. 저장된 연결, 터널, 서버 대시보드를 지원합니다.
- **미리 보기와 도구.** 로컬 개발 서버 미리 보기(SSH 경유 포함), 미디어 및 PDF 뷰어, API 클라이언트, MCP 클라이언트.
- **휴대폰 동반 앱.** QR 코드로 연결해 로컬 네트워크에서 AI 세션을 확인하고 제어하는 미리 보기 Android 앱.

### 기본적으로 비공개

계정이 필요 없고 Voktty 텔레메트리도 없습니다. 제공업체 키는 OS 키체인에 저장되고, 네이티브 파일 시스템 접근은 워크스페이스별로 승인되며, AI 파일 도구는 비밀 경로를 거부하고, 전체 액세스를 허용하지 않는 한 변경을 일으키는 모든 도구 호출은 먼저 묻습니다.

전체 기능 목록은 [docs/features.md](../features.md)(영어)에 있습니다.

## 설치

최신 설치 프로그램은 [Releases](https://github.com/voktty/voktty/releases/latest) 페이지에 있습니다. Voktty는 이 페이지에서 자동 업데이트됩니다.

### Windows 참고 사항

- 기본 셸 감지: `pwsh.exe`(PowerShell 7+) -> `powershell.exe`(Windows PowerShell 5.1) -> `cmd.exe`.
- WSL은 래핑된 하위 프로세스가 아니라 완전한 워크스페이스 환경입니다.

### Linux 참고 사항

- **Arch / AUR:** `yay -S voktty-bin` 또는 `paru`. 최신 릴리스를 추적합니다.
- **NixOS / Nix:** 공식 flake를 사용하세요. NixOS 외부에서는 `nix profile install github:voktty/voktty`를 실행합니다. NixOS에서는 flake를 가져오고 `inputs.voktty.packages.${pkgs.system}.voktty`를 `environment.systemPackages`에 추가합니다. 더 간단한 설정에는 `nixosModules.voktty`도 있습니다.
- **AppImage:** FUSE가 필요합니다. 없다면 `./Voktty_*.AppImage --appimage-extract-and-run`을 실행하세요. Wayland 렌더링 문제가 있으면 `WEBKIT_DISABLE_DMABUF_RENDERER=1`을 시도하세요. `.deb` / `.rpm` 패키지는 시스템 GTK 스택을 사용해 보통 더 부드럽습니다.

## 에이전트와 AI 설정

1. **코딩 에이전트.** 사용하는 에이전트 CLI(예: Claude Code 또는 Codex)를 설치하고 평소처럼 로그인하세요. Voktty가 이를 찾아 각자의 로그인을 사용합니다. SSH 프로젝트에서는 서버에 설치하세요.
2. **API 모델.** 설정을 열어 **AI 모델**로 이동한 뒤 키가 있는 제공업체나 사용자 지정 엔드포인트를 추가하거나, 로컬 LM Studio, MLX, Ollama 서버를 지정하세요. 그러면 모델이 Harness 모델 선택기의 **API** 아래에 나타납니다.
3. 키는 `keyring`을 통해 OS 키체인에 저장되며 `localStorage`에는 저장되지 않습니다. 세션 버스나 Secret Service가 없는 Linux에서는 Voktty가 모드 0600의 비공개 대체 파일을 사용합니다.

## 소스에서 빌드

**필수 항목**

- Rust(stable), https://rustup.rs
- Node 20+와 [pnpm](https://pnpm.io)
- 플랫폼별 Tauri 필수 항목, https://tauri.app/start/prerequisites/

**실행**

```bash
pnpm install
pnpm tauri dev          # 개발
pnpm tauri build        # 프로덕션 번들
```

**검사**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # CI와 동일한 Rust 린트
cd src-tauri && cargo nextest run --locked                           # 또는 cargo test --locked
```

## 기술 스택

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui, Zustand.

## 기여

Issue와 PR을 환영합니다. 문제를 보고하고 기능을 제안하거나 Pull Request를 제출하세요. 자세한 내용은 [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md)와 [아키텍처 문서](../README.md)를 참조하세요. 프로젝트의 방향은 [로드맵](../../ROADMAP.md)에 있습니다.

## 플랫폼 서명 상태

현재 프리뷰 빌드는 Windows와 macOS용 운영 체제 코드 서명 및 공증 없이 생성됩니다. 설치 프로그램과 애플리케이션 번들이 아직 해당 플랫폼에서 신뢰된 것으로 인식되지 않기 때문에 Windows SmartScreen과 macOS Gatekeeper가 경고를 표시할 수 있습니다.

이 경고만으로 악성 코드라고 증명되는 것은 아니지만, Voktty 공식 릴리스 채널에서 내려받고 체크섬 또는 릴리스 서명을 확인한 빌드만 설치하세요. Voktty 업데이터 서명은 운영 체제 코드 서명과 별개이며, 해당 릴리스 키가 구성된 경우에만 업데이트의 진위를 보호합니다.

플랫폼 인증서와 공증은 안정 버전 배포 전에 추가됩니다.

<br clear="left" />

## 출처와 저작자 표시

Voktty는 Terax(Crynta)에서 독립한 포크이며, Agent Harness는 MonoCode(MIT, 작성자 Nick)에서 파생되었습니다. 두 저작자 모두 Voktty와 제휴 관계가 아니며 이를 보증하지 않습니다. [NOTICE](../../NOTICE)와 [LICENSE](../../LICENSE)를 참고하세요.

## 라이선스

Voktty는 Apache-2.0 라이선스를 따릅니다. 종속성에 대한 자세한 내용은 [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE)을 참조하세요.
