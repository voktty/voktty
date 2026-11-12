<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>

  <p><strong>El espacio de trabajo donde trabajan tus agentes de programación.</strong></p>

  <p>
    <a href="https://voktty.dev">Sitio web</a> ·
    <a href="https://voktty.dev/docs">Documentación</a> ·
    <a href="https://github.com/voktty/voktty">Código fuente</a>
  </p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="versión" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="descargas" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="plataforma" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
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

Voktty es un espacio de trabajo de escritorio, de código abierto, para agentes de programación con IA, construido con Tauri 2, Rust y React 19. Su Agent Harness ejecuta Claude Code, Codex, Gemini (mediante Antigravity), Cursor, Grok, OpenCode, Pi y cualquier modelo al que accedas por API, en proyectos locales y por SSH, con aprobaciones, revisión de cambios, memoria de proyecto compartida y coordinación de equipos. A su alrededor hay una terminal nativa, un editor de código, Git y entornos locales, WSL, SSH, Docker, serie y escritorio remoto. Sin cuenta y sin telemetría. Los instaladores pesan entre 25 y 36 MB (v1.0.27; el AppImage de Linux, unos 118 MB).

## Capturas de pantalla

Las capturas usan la interfaz en español; hay más en la [galería](../screenshots.md).

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness: un agente edita un proyecto y sus cambios aparecen como un diff que puedes conservar o deshacer" /><br/><sub>Agent Harness: un agente edita un proyecto y sus cambios aparecen como un diff que puedes conservar o deshacer</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="Proyecto SSH: archivos remotos junto a una terminal en vivo en el servidor" /><br/><sub>Proyecto SSH: archivos remotos junto a una terminal en vivo en el servidor</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="Chat de IA flotante que lee el directorio, los comandos recientes y la salida de la terminal activa" /><br/><sub>Chat de IA flotante que lee el directorio, los comandos recientes y la salida de la terminal activa</sub>
</p>

## Qué ofrece

### Agentes

- **Muchos agentes, un solo lugar.** Sesiones de Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode y Pi en paralelo, cada una con su propia CLI y su propia sesión iniciada.
- **Cualquier modelo de API como agente.** Proveedores en la nube, endpoints propios y modelos locales de Ollama, LM Studio o MLX pueden leer, buscar, editar y ejecutar comandos en un proyecto, con las mismas comprobaciones de espacio de trabajo y de rutas secretas que el chat de IA. El bucle del agente y tu clave se quedan en tu equipo.
- **Tú decides hasta dónde llegan.** Las sesiones supervisadas piden permiso antes de cada escritura o comando; con acceso completo no. Las ediciones aparecen como diffs que puedes conservar o deshacer.
- **Agentes en tus servidores.** En proyectos SSH, Claude Code, Codex y OpenCode se ejecutan en el servidor y una conexión caída no los detiene. Los modelos de API leen, buscan y editan archivos remotos, y ejecutan comandos cuando el helper remoto está actualizado.
- **Equipos de agentes.** Un roster con roles y reglas, un tablero de quién trabaja o espera, un orquestador que inicia y escribe a los demás, y un registro de lo que se dicen entre ellos y te dicen a ti. Consulta la [guía de equipos de agentes](../guides/agent-teams.md).
- **Memoria y presencia.** Inspecciona y restaura lo que los agentes recuerdan de un proyecto, recibe un aviso cuando un agente de cualquier host abierto te espera y mira los agentes en marcha en el Notch opcional (alfa).

### El espacio de trabajo a su alrededor

- **Terminal.** PTY nativo con renderizado WebGL, modos raw y por bloques, paneles, espacios y terminales privadas.
- **Editor.** CodeMirror 6 con LSP opcional, autocompletado y ediciones con IA, Quick Open y búsqueda y reemplazo con vista previa.
- **Git.** Control de código fuente, historial con grafo de commits, worktrees y commits asistidos por IA.
- **Entornos.** Local, WSL, SSH, Docker, serie y RDP, con conexiones guardadas, túneles y un panel del servidor.
- **Vistas previas y herramientas.** Vista previa de servidores de desarrollo locales (también por SSH), visores de medios y PDF, un cliente de API y un cliente MCP.
- **Compañero en el móvil.** Una app Android en versión preliminar que se empareja con un código QR para seguir y dirigir sesiones de IA por tu red local.

### Privado por defecto

Sin cuenta y sin telemetría de Voktty. Las claves de los proveedores viven en el llavero del sistema, el acceso nativo al sistema de archivos se autoriza por espacio de trabajo, las herramientas de archivos de la IA rechazan las rutas secretas y toda herramienta que modifica algo pide permiso salvo que concedas acceso completo.

La lista completa de funciones está en [docs/features.md](../features.md) (en inglés).

## Instalación

Los instaladores más recientes están en la página de [Releases](https://github.com/voktty/voktty/releases/latest). Voktty se actualiza automáticamente desde allí.

### Notas para Windows

- Detección predeterminada del shell: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL es un entorno de espacio de trabajo de primera clase, no un subproceso encapsulado.

### Notas para Linux

- **Arch / AUR:** `yay -S voktty-bin` (o `paru`, etc.). Sigue la versión más reciente.
- **NixOS / Nix:** usa el flake oficial: `nix profile install github:voktty/voktty` en sistemas que no sean NixOS, o importa el flake y añade `inputs.voktty.packages.${pkgs.system}.voktty` a `environment.systemPackages` en NixOS. También está disponible `nixosModules.voktty` para una configuración más sencilla.
- **AppImage:** requiere FUSE. Sin FUSE: `./Voktty_*.AppImage --appimage-extract-and-run`. Si hay problemas de renderizado en Wayland, prueba `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Los paquetes `.deb` / `.rpm` enlazan con la pila GTK del sistema y suelen funcionar con mayor fluidez.

## Configurar agentes e IA

1. **Agentes de programación.** Instala las CLI de agentes que uses (por ejemplo Claude Code o Codex) e inicia sesión como siempre. Voktty las encuentra y usa su propia sesión. Para proyectos SSH, instálalas en el servidor.
2. **Modelos de API.** Abre los ajustes y ve a **Modelos IA**, añade un proveedor con su clave o un endpoint propio, o apunta Voktty a un servidor local de LM Studio, MLX u Ollama. Los modelos aparecerán en el selector del Harness, en **API**.
3. Las claves se guardan en el llavero del sistema mediante `keyring` y nunca en `localStorage`. En Linux, si no hay bus de sesión o Secret Service, Voktty usa un archivo privado de respaldo con modo 0600.

## Compilar desde el código fuente

**Requisitos previos**

- Rust (stable), https://rustup.rs
- Node 20+ y [pnpm](https://pnpm.io)
- Requisitos previos de Tauri para tu plataforma, https://tauri.app/start/prerequisites/

**Ejecutar**

```bash
pnpm install
pnpm tauri dev          # desarrollo
pnpm tauri build        # paquete de producción
```

**Comprobaciones**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # lint de Rust (igual que CI)
cd src-tauri && cargo nextest run --locked                           # o: cargo test --locked
```

## Tecnologías

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui y Zustand.

## Contribuir

Se aceptan issues y PR. Puedes informar de problemas, sugerir funciones o enviar pull requests. Consulta [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) y la [documentación de arquitectura](../README.md) para obtener más información. La dirección del proyecto está en la [hoja de ruta](../../ROADMAP.md).

## Estado de la firma de plataforma

Las compilaciones preliminares actuales se generan sin firma de código del sistema operativo ni notarización para Windows y macOS. Windows SmartScreen y macOS Gatekeeper pueden mostrar advertencias porque los instaladores y paquetes de la aplicación todavía no están reconocidos como confiables por esas plataformas.

Estas advertencias no demuestran por sí solas que exista malware, pero instala únicamente compilaciones descargadas desde los canales oficiales de Voktty después de verificar su checksum o firma de release. La firma del actualizador de Voktty es independiente de la firma del sistema operativo y solo protege la autenticidad de las actualizaciones cuando la clave de release correspondiente está configurada.

Los certificados de plataforma y la notarización se añadirán antes de la distribución estable.

<br clear="left" />

## Origen y atribución

Voktty es un fork independiente de Terax (Crynta) y su Agent Harness deriva de MonoCode (MIT, de Nick). Ninguno de los autores está afiliado a Voktty ni lo respalda. Consulta [NOTICE](../../NOTICE) y [LICENSE](../../LICENSE).

## Licencia

Voktty se distribuye bajo la licencia Apache-2.0. Para más información sobre las dependencias, consulta [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
