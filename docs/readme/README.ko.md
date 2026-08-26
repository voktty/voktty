<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>가볍고 터미널 중심인 AI 네이티브 개발 워크스페이스.</strong></p>
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

Voktty는 Tauri 2 + Rust와 React 19로 만든 가볍고 오픈 소스이며 터미널 중심인 AI 네이티브 개발 환경(ADE)입니다. WebGL 렌더러를 갖춘 네이티브 PTY 백엔드, 사용자의 키나 완전한 로컬 모델로 실행되는 에이전트형 AI 사이드 패널, 코드 편집기, 파일 탐색기, Git 그래프를 포함한 소스 제어, 웹 미리보기 패널이 내장되어 있습니다. 디스크 사용량은 약 7-8 MB입니다. 원격 측정 없음. 계정 필요 없음.

## 스크린샷

<table>
  <tr><td align="center"><img src="../images/voktty_0stHyTBbyY.png" alt="워크스페이스" /><br/><sub>파일과 탭이 있는 Voktty 워크스페이스</sub></td><td align="center"><img src="../images/voktty_ljubKqX22C.png" alt="터미널 Copilot" /><br/><sub>자연어를 지원하는 터미널 Copilot</sub></td></tr>
  <tr><td align="center"><img src="../images/voktty_kLd3UCiAji.png" alt="테마" style="margin-top: 12px;"/><br/><sub>사용자 지정 테마와 프리셋</sub></td><td align="center"><img src="../images/voktty_kiAdbgrGGj.png" alt="소스 제어와 Git 그래프" style="margin-top: 12px;"/><br/><sub>Git 그래프가 포함된 소스 제어 패널</sub></td></tr>
  <tr><td colspan="2" align="center"><img src="../images/voktty_wiRVOca2A5.png" alt="터미널" style="border-radius: 4px; margin-top: 12px;" /><br/><sub>시스템 정보와 파일 탐색기가 있는 터미널</sub></td></tr>
</table>

## 기능

### 터미널

- WebGL 렌더러, 다중 탭, 백그라운드 스트리밍을 지원하는 xterm.js
- 편집기와 같은 명령 입력을 갖춘 GPU 가속 블록 기반 터미널
- `portable-pty`를 통한 네이티브 PTY 백엔드(zsh, bash, pwsh, fish, cmd)
- 가로 및 세로 분할 패널
- 인라인 검색, 링크 감지, 트루 컬러
- 탐색기나 데스크톱의 파일을 셸에서 안전하게 인용된 경로로 터미널에 드래그
- Windows의 탭별 워크스페이스 환경(Local 또는 설치된 WSL 배포판)
- Spaces가 탭, 작업 디렉터리, 분할 레이아웃을 다음 실행 시 복원

### 코드 편집기

- CodeMirror 6(TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, Markdown 등 주요 언어 지원)
- 로컬 모델을 지원하는 인라인 AI 자동 완성
- AI 편집 차이를 헝크별로 수락하거나 거부
- 진단, 탐색, 완성, 포매팅, 사용자 지정 서버를 제공하는 선택형 언어 서버
- Markdown 렌더링과 이미지, 비디오, 오디오, PDF 보기
- Vim 모드
- Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub, Xcode 등의 내장 테마

### 소스 제어

- 헝크 스테이지 / 스테이지 해제, 커밋(Cmd+Enter / Ctrl+Enter), 업스트림을 인식하는 푸시
- 분리된 HEAD 상태를 포함한 브랜치 표시
- 병합과 브랜치 레인을 그리는 실제 커밋 그래프가 있는 Git 히스토리
- 커밋 검색 및 필터, 원격 커밋 페이지 열기

### 파일 탐색기

- Catppuccin 아이콘 테마
- 퍼지 검색, 키보드 탐색, 인라인 이름 변경, 컨텍스트 작업
- 디스크에서 파일이 바뀌면 실시간 업데이트
- 파일과 선택 항목을 AI 사이드 패널에 직접 첨부

### 웹 미리보기

- 로컬 개발 서버를 자동 감지해 미리보기 탭에서 열기
- 네이티브 자식 WebView를 통한 외부 URL 미리보기

### 테마와 사용자 지정

- 앱에서 사용자 지정 테마를 만들고 내장 프리셋과 전환
- 테마를 공유하거나 커뮤니티에서 가져오기
- 불투명도와 블러를 조절할 수 있는 배경 이미지
- 편집기 테마는 앱 테마와 독립적

### AI

- **BYOK 제공자:** OpenAI, Anthropic, Google(Gemini), Groq, xAI(Grok), Cerebras, OpenRouter, DeepSeek, Mistral 및 모든 OpenAI 호환 엔드포인트
- **로컬 / 오프라인:** LM Studio, MLX, Ollama
- **에이전트형 워크플로:** 계획, 하위 에이전트, `VOKTTY.md`를 통한 프로젝트 메모리, 파일 읽기 / 쓰기 / 편집 / 다중 편집 / grep / glob, 승인형 bash, 백그라운드 프로세스
- **코딩 에이전트 오케스트레이션:** 터미널에서 Claude Code를 실행하고 출력을 확인한 뒤 승인형 도구로 후속 작업 전송
- **작성기:** `#handle` 프롬프트 스니펫, `@path` 파일, 음성 입력, 탐색기나 선택 항목에서 에이전트로 첨부
- 자체 시스템 프롬프트와 도구 하위 집합을 가진 **사용자 지정 에이전트**
- 실행 전에 계획을 만들고 확인하는 **계획 모드**

## Voktty 최신 기능

- **평면 복합 Spaces:** 독립 탭은 이름이 있는 Spaces와 분리됩니다. 구성원을 결정적으로 재정렬할 수 있으며 2, 4, 6 또는 8개의 뷰를 지원하고 중첩 Spaces는 허용하지 않습니다.
- **IDE 및 디버깅:** CodeMirror 6, 심볼 탐색, Problems 패널, 코드 작업, Ghost 자동 완성, 검토 가능한 diff 변경과 호환 어댑터가 설정된 경우의 DAP 디버깅을 제공합니다.
- **안전한 MCP 클라이언트:** 로컬 stdio 서버 또는 원격 Streamable HTTP 서버에 연결할 수 있습니다. 도구는 검증되며 변경 작업에는 네이티브 일회성 승인이 필요합니다.
- **네이티브 확장:** `~/.voktty/extensions/`의 JavaScript 확장으로 명령, 단축키, AI 도구, 알림 및 workspace 작업을 추가할 수 있습니다. Voktty API이며 VS Code 확장 호환 계층은 아닙니다.
- **터미널 협업:** 관찰자와 제어자 역할, 추가 암호화, 읽기 전용 원격 파일 인용을 지원하는 터미널 임시 공유 기능입니다.
- **연결 및 성능:** Local, WSL, SSH, Docker 및 serial 환경이 연결 수명 주기를 표시하며, 숨겨진 터미널은 활성 프로세스를 중지하지 않고 비용이 큰 렌더러를 해제합니다.
- **에이전트 상태 표시:** 역할별 아바타, 외부 에이전트용 애니메이션 아이콘, 저장·Git·Problems·디버깅·에이전트 응답용 선택적 로컬 사운드를 제공하고 동작 줄이기 설정을 지원합니다.

보안 경계와 플랫폼별 지원을 포함한 전체 최신 기능 목록은 [영문 README](../../README.md)에서 확인할 수 있습니다.

## 설치

최신 설치 프로그램은 [Releases](https://github.com/voktty/voktty/releases/latest) 페이지에 있습니다. Voktty는 이 페이지에서 자동 업데이트됩니다.

### Windows 참고 사항

- 기본 셸 감지: `pwsh.exe`(PowerShell 7+) -> `powershell.exe`(Windows PowerShell 5.1) -> `cmd.exe`.
- WSL은 래핑된 하위 프로세스가 아니라 완전한 워크스페이스 환경입니다.

### Linux 참고 사항

- **Arch / AUR:** `yay -S voktty-bin` 또는 `paru`. 최신 릴리스를 추적합니다.
- **NixOS / Nix:** 공식 flake를 사용하세요. NixOS 외부에서는 `nix profile install github:voktty/voktty`를 실행합니다. NixOS에서는 flake를 가져오고 `inputs.voktty.packages.${pkgs.system}.voktty`를 `environment.systemPackages`에 추가합니다. 더 간단한 설정에는 `nixosModules.voktty`도 있습니다.
- **AppImage:** FUSE가 필요합니다. 없다면 `./Voktty_*.AppImage --appimage-extract-and-run`을 실행하세요. Wayland 렌더링 문제가 있으면 `WEBKIT_DISABLE_DMABUF_RENDERER=1`을 시도하세요. `.deb` / `.rpm` 패키지는 시스템 GTK 스택을 사용해 보통 더 부드럽습니다.

## AI 설정

1. **설정 -> AI**를 엽니다.
2. 제공자를 선택하고 API 키를 붙여 넣습니다. 로컬 추론은 LM Studio / MLX / Ollama 엔드포인트를 지정합니다.
3. 키는 `keyring`을 통해 OS 키체인에 저장됩니다. 디스크나 localStorage에는 기록되지 않습니다.

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

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK v6, Tailwind v4, shadcn/ui, Zustand.

## 기여

Issue와 PR을 환영합니다. 문제를 보고하고 기능을 제안하거나 Pull Request를 제출하세요. 자세한 내용은 [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md)와 [아키텍처 문서](../README.md)를 참조하세요.

## 플랫폼 서명 상태

현재 프리뷰 빌드는 Windows와 macOS용 운영 체제 코드 서명 및 공증 없이 생성됩니다. 설치 프로그램과 애플리케이션 번들이 아직 해당 플랫폼에서 신뢰된 것으로 인식되지 않기 때문에 Windows SmartScreen과 macOS Gatekeeper가 경고를 표시할 수 있습니다.

이 경고만으로 악성 코드라고 증명되는 것은 아니지만, Voktty 공식 릴리스 채널에서 내려받고 체크섬 또는 릴리스 서명을 확인한 빌드만 설치하세요. Voktty 업데이터 서명은 운영 체제 코드 서명과 별개이며, 해당 릴리스 키가 구성된 경우에만 업데이트의 진위를 보호합니다.

플랫폼 인증서와 공증은 안정 버전 배포 전에 추가됩니다.

<br clear="left" />

## 라이선스

Voktty는 Apache-2.0 라이선스를 따릅니다. 종속성에 대한 자세한 내용은 [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE)을 참조하세요.
