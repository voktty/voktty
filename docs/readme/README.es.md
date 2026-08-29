<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>

  <p><strong>Espacio de desarrollo ligero, centrado en la terminal y nativo de IA.</strong></p>

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

Voktty es un entorno de desarrollo (ADE) ligero, de código abierto, centrado en la terminal y nativo de IA, construido con Tauri 2 + Rust y React 19. Incluye un backend PTY nativo con renderizador WebGL, un panel lateral de IA con agentes que funciona con tus propias claves o modelos completamente locales, además de editor de código, explorador de archivos, control de código fuente con gráfico de Git y panel de vista previa web. Ocupa unos 7-8 MB en disco. Sin telemetría. Sin cuenta.

## Capturas de pantalla

<table>
  <tr><td align="center"><img src="../images/voktty_6LhZMEZPC6.png" alt="Cliente API y sandbox" /><br/><sub>Cliente API y sandbox con constructor de solicitudes y análisis de respuestas</sub></td><td align="center"><img src="../images/voktty_E7ePo9A5ka.png" alt="Historial operativo de agentes" /><br/><sub>Historial y recuperación de agentes con sesiones y transcripciones buscables</sub></td></tr>
  <tr><td align="center"><img src="../images/voktty_k5Xr4AqgSA.png" alt="Selector de entornos" /><br/><sub>Selección de entornos locales, WSL, SSH, RDP y serie</sub></td><td align="center"><img src="../images/voktty_MAZn6eHFXb.png" alt="Editor y terminal" /><br/><sub>Editor de código, terminal, panel de IA e información de archivos al pasar el cursor</sub></td></tr>
  <tr><td colspan="2" align="center"><img src="../images/voktty_vPOlZrpa70.png" alt="Vista previa de archivos" /><br/><sub>Vista previa de imágenes y metadatos de archivos desde el explorador</sub></td></tr>
</table>

## Funciones

### Terminal y Shell

- **Arquitectura de doble modo:** Alterna al instante entre terminal clásica raw xterm.js y terminal agéntica por bloques acelerada por GPU (`Ctrl+U` / menú contextual de pestaña) en caliente sin reiniciar la sesión ni matar procesos PTY.
- **Backend PTY nativo:** Sesiones de terminal de alto rendimiento mediante `portable-pty` con autodetección de PowerShell 7 (`pwsh`), Windows PowerShell, Símbolo del sistema (`cmd`), Bash, Zsh y Fish.
- **Inline Terminal Copilot (`Ctrl+K` / `Cmd+K`):** Barra flotante de IA que genera comandos adaptados a tu SO, shell y directorio activo (CWD), con acciones para insertar (`Enter`), ejecutar (`Shift+Enter`), copiar o regenerar.
- **Entrada IA Agéntica en Terminal (`Ctrl+U`):** Instrucciones en lenguaje natural traducidas a comandos shell seguros con vista previa interactiva (`Enter` para ejecutar, `Esc` para cancelar) y autorización persistente *"Permitir siempre en esta pestaña"*.
- **⚡ "Corregir con IA" y Explicar Errores (OSC 133):** Detección semántica de bloques de comando con análisis de código de salida (`exitCode !== 0`) y botón de corrección con IA en 1 clic directamente en el bloque fallido.
- **Autosugerencias Inteligentes (Ghost Text):** Autocompletado inline estilo Fish/Zsh con lectura del historial nativo de PowerShell (`PSReadLine`), aceptación completa (`Tab` / `Flecha derecha`) y paso palabra por palabra (`Alt+Flecha derecha` / `Ctrl+Flecha derecha`).
- **HUD de Scripts del Proyecto:** Detección automática y ejecución en 1 clic de scripts definidos en `package.json` (pnpm, npm, yarn, bun), `Cargo.toml`, `Makefile`, `docker-compose.yml`, `pyproject.toml` y `go.mod`.
- **Resolución Interactiva de Enlaces:** Rutas de archivo y URLs clicables con salto de línea/columna directo al editor, más reparación automática en 1 clic de repositorios Git con errores `safe.directory` / *dubious ownership*.
- **Terminal por Puerto Serie (COM / TTY):** Conexión directa a microcontroladores y placas IoT (ESP32, Arduino, Raspberry Pi Pico) con selector de baud rate en tiempo real, control de paridad y flujo, conmutación DTR/RTS y botón de pulso de Reset hardware.
- **Cliente SSH y Túneles Port Forwarding:** Sesiones SSH completas con monitorización de latencia en vivo, telemetría remota (CPU, RAM, Disco) y gestión visual de túneles SSH (`-L`, `-R`, `-D`).
- **Colaboración de Terminal P2P en Vivo:** Terminal compartida en tiempo real con cifrado de extremo a extremo (AES-256-GCM + HMAC), roles (Observador / Controlador), sincronización de snapshot de estado (hasta 512 KiB vía xterm) y reconexión automática con backpressure.
- **Soporte Multi-entorno:** Ejecuta shells locales, cualquier distro WSL instalada, contenedores Docker o instancias SSH remotas como pestañas de primer nivel.
- **División de Paneles y Ventanas:** División de paneles 2D en horizontal y vertical, navegación por teclado e intercambio direccional de paneles.
- **Barras de Pestañas Vertical y Horizontal:** Tarjetas enriquecidas de 2 líneas, indicadores de proceso y cambios sin guardar, buscador de pestañas en tiempo real, bloqueo de pestañas y etiquetas de color.
- **Launchpad de Pestañas Activas (`Ctrl+P` / `Cmd+P`):** Modal de búsqueda universal instantánea en todas las pestañas, terminales y espacios de trabajo abiertos.
- **Arrastrar y Soltar:** Arrastra archivos desde el explorador o el escritorio a la terminal como rutas entrecomilladas seguras.
- **Espacios de Trabajo:** Restaura pestañas, directorios de trabajo, shells activos y distribuciones de paneles entre inicios.

### Editor de código

- CodeMirror 6 (compatible con los lenguajes más populares: TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, Markdown, etc.)
- Autocompletado de IA integrado con soporte para modelos locales
- Diferencias de edición de IA, aceptables o rechazables bloque por bloque
- **⚡ Quick Fix Agéntico (`Alt+Enter`):** Resolución de diagnósticos LSP y sugerencias de corrección en 1 clic desde los breadcrumbs o posición del cursor.
- **Diff Gutter en tiempo real:** Resaltado de inserciones, modificaciones y eliminaciones respecto a la versión guardada en disco.
- Compatibilidad opcional con servidores de lenguaje (LSP), diagnósticos, navegación, autocompletado, formato y servidores personalizados
- Markdown renderizado y visualización de imágenes, vídeo, audio y PDF
- Modo Vim
- Temas integrados como Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub y Xcode

### Control de código fuente

- Preparar o retirar bloques, confirmar (Cmd+Enter / Ctrl+Enter) y enviar con conocimiento de la rama remota
- **Staging Semántico con IA:** Agrupación automática de diffs en Conventional Commits (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`) con generación de mensaje en 1 clic.
- Visualización de ramas, incluido el estado HEAD separado
- Panel de historial de Git con un gráfico real de commits (carriles para fusiones y ramas)
- Búsqueda y filtro de commits, con acceso a la página del commit remoto

### Explorador de archivos

- Tema de iconos Catppuccin
- Búsqueda difusa, navegación por teclado, cambio de nombre integrado y acciones contextuales
- Actualizaciones en directo cuando cambian los archivos en disco
- Adjunta archivos y selecciones directamente al panel lateral de IA mediante arrastrar y soltar

### Vista previa web y RDP

- Detecta servidores de desarrollo locales y los abre en una pestaña de vista previa con ejecución en segundo plano
- Vista previa de URL externas mediante una vista web secundaria nativa
- Sesiones integradas de escritorio remoto (RDP)

### Temas y personalización

- Crea temas personalizados en la aplicación y alterna entre preajustes incluidos y temas propios
- Comparte tus temas o impórtalos de la comunidad
- Imágenes de fondo con opacidad y desenfoque ajustables
- Lienzo translúcido Acrylic / Mica con paleta Campbell Modern ANSI
- El tema del editor es independiente del tema de la aplicación
- **Motor de Extensiones (estándar VS Code):** Carga y descarga módulos en caliente desde `~/.voktty/extensions/` con suscripciones y herramientas personalizadas.

### IA

- **Proveedores con tu propia clave (BYOK):** OpenAI, Anthropic, Google (Gemini), Groq, xAI (Grok), Cerebras, OpenRouter, DeepSeek, Mistral y cualquier endpoint compatible con OpenAI
- **Local / sin conexión:** LM Studio, MLX, Ollama
- **Flujo con agentes:** planes, subagentes, memoria de proyecto mediante `VOKTTY.md`, lectura / escritura / edición / edición múltiple / grep / glob, bash con aprobación y procesos en segundo plano
- **Orquestación de agentes de programación:** inicia Claude Code en una terminal, revisa su salida y envía trabajo adicional mediante herramientas sujetas a aprobación
- **Compositor:** fragmentos de prompt con `#handle`, archivos con `@path`, entrada de voz y adjuntos desde el explorador o una selección
- **Agentes personalizados** con su propio prompt de sistema y subconjunto de herramientas
- **Modo de planificación** que genera un plan y solicita confirmación antes de actuar

## Novedades actuales de Voktty

- **Espacios compuestos planos:** separa las pestañas sueltas de los espacios con nombre, reorganiza sus miembros y usa 2, 4, 6 u 8 vistas sin espacios anidados.
- **IDE y depuración:** CodeMirror 6, navegación de símbolos, panel Problemas, acciones de código, autocompletado fantasma, ediciones con diff y depuración mediante DAP cuando hay un adaptador configurado.
- **Cliente MCP seguro:** conecta servidores locales por stdio o servidores remotos por Streamable HTTP. Las herramientas se validan y las mutaciones requieren una aprobación nativa de un solo uso.
- **Extensiones nativas:** instala extensiones JavaScript desde `~/.voktty/extensions/` para añadir comandos, atajos, herramientas de IA, notificaciones y acciones del workspace. Es una API propia de Voktty, no compatibilidad con extensiones de VS Code.
- **Colaboración de terminal:** comparte temporalmente una terminal con roles de observador y controlador, cifrado adicional y citas remotas de archivos solo de lectura.
- **Conexiones y rendimiento:** Local, WSL, SSH, Docker y serie muestran su ciclo de conexión; los terminales ocultos liberan renderizado costoso sin detener los procesos activos.
- **Presencia del agente:** avatares por rol, iconos animados para agentes externos y sonidos locales opcionales para guardados, Git, Problemas, depuración y respuestas del agente, compatibles con movimiento reducido.

La lista completa y canónica de funciones se mantiene en el [README en inglés](../../README.md), junto con sus límites de seguridad y disponibilidad por plataforma.

## Instalación

Los instaladores más recientes están en la página de [Releases](https://github.com/voktty/voktty/releases/latest). Voktty se actualiza automáticamente desde allí.

### Notas para Windows

- Detección predeterminada del shell: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL es un entorno de espacio de trabajo de primera clase, no un subproceso encapsulado.

### Notas para Linux

- **Arch / AUR:** `yay -S voktty-bin` (o `paru`, etc.). Sigue la versión más reciente.
- **NixOS / Nix:** usa el flake oficial: `nix profile install github:voktty/voktty` en sistemas que no sean NixOS, o importa el flake y añade `inputs.voktty.packages.${pkgs.system}.voktty` a `environment.systemPackages` en NixOS. También está disponible `nixosModules.voktty` para una configuración más sencilla.
- **AppImage:** requiere FUSE. Sin FUSE: `./Voktty_*.AppImage --appimage-extract-and-run`. Si hay problemas de renderizado en Wayland, prueba `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Los paquetes `.deb` / `.rpm` enlazan con la pila GTK del sistema y suelen funcionar con mayor fluidez.

## Configurar la IA

1. Abre **Ajustes -> IA**.
2. Elige un proveedor y pega tu clave API. Para inferencia local, apunta Voktty a tu endpoint de LM Studio / MLX / Ollama.
3. Las claves se guardan en el llavero del sistema mediante `keyring`. Nunca se escriben en disco ni en localStorage.

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

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK v6, Tailwind v4, shadcn/ui y Zustand.

## Contribuir

Se aceptan issues y PR. Puedes informar de problemas, sugerir funciones o enviar pull requests. Consulta [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) y la [documentación de arquitectura](../README.md) para obtener más información.

## Estado de la firma de plataforma

Las compilaciones preliminares actuales se generan sin firma de código del sistema operativo ni notarización para Windows y macOS. Windows SmartScreen y macOS Gatekeeper pueden mostrar advertencias porque los instaladores y paquetes de la aplicación todavía no están reconocidos como confiables por esas plataformas.

Estas advertencias no demuestran por sí solas que exista malware, pero instala únicamente compilaciones descargadas desde los canales oficiales de Voktty después de verificar su checksum o firma de release. La firma del actualizador de Voktty es independiente de la firma del sistema operativo y solo protege la autenticidad de las actualizaciones cuando la clave de release correspondiente está configurada.

Los certificados de plataforma y la notarización se añadirán antes de la distribución estable.

<br clear="left" />

## Licencia

Voktty se distribuye bajo la licencia Apache-2.0. Para más información sobre las dependencias, consulta [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
