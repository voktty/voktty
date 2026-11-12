<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>O espaço de trabalho onde seus agentes de programação trabalham.</strong></p>
  <p><a href="https://voktty.dev">Site</a> · <a href="https://voktty.dev/docs">Documentação</a> · <a href="https://github.com/voktty/voktty">Código-fonte do site</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="versão" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="downloads" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="plataforma" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.id.md">Bahasa Indonesia</a> | <a href="README.hi.md">हिन्दी</a>
</p>

---

O Voktty é um espaço de trabalho de desktop, de código aberto, para agentes de programação com IA, construído com Tauri 2, Rust e React 19. O Agent Harness executa Claude Code, Codex, Gemini (via Antigravity), Cursor, Grok, OpenCode, Pi e qualquer modelo acessível por API, em projetos locais e por SSH, com aprovações, revisão de alterações, memória de projeto compartilhada e coordenação de equipes. Ao redor há um terminal nativo, um editor de código, Git e ambientes locais, WSL, SSH, Docker, serial e área de trabalho remota. Sem conta e sem telemetria. Os instaladores têm de 25 a 36 MB (v1.0.27; o AppImage do Linux, cerca de 118 MB).

## Capturas de tela

As capturas usam a interface em espanhol; há mais na [galeria](../screenshots.md).

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness: um agente edita um projeto e as alterações aparecem como um diff para manter ou desfazer" /><br/><sub>Agent Harness: um agente edita um projeto e as alterações aparecem como um diff para manter ou desfazer</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="Projeto SSH: arquivos remotos ao lado de um terminal ao vivo no servidor" /><br/><sub>Projeto SSH: arquivos remotos ao lado de um terminal ao vivo no servidor</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="Chat de IA flutuante que lê o diretório, os comandos recentes e a saída do terminal ativo" /><br/><sub>Chat de IA flutuante que lê o diretório, os comandos recentes e a saída do terminal ativo</sub>
</p>

## O que você recebe

### Agentes

- **Vários agentes, um só lugar.** Sessões de Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode e Pi lado a lado, cada uma com sua própria CLI e seu próprio login.
- **Qualquer modelo de API como agente.** Provedores na nuvem, endpoints personalizados e modelos locais do Ollama, LM Studio ou MLX podem ler, buscar, editar e executar comandos em um projeto, com as mesmas verificações de espaço de trabalho e de caminhos secretos do chat de IA. O laço do agente e sua chave ficam no seu computador.
- **Você decide até onde eles vão.** Sessões supervisionadas pedem permissão antes de cada escrita ou comando; o acesso total não pede. As edições aparecem como diffs que você pode manter ou desfazer.
- **Agentes nos seus servidores.** Em projetos SSH, Claude Code, Codex e OpenCode rodam no servidor e uma conexão perdida não os interrompe. Os modelos de API leem, buscam e editam arquivos remotos e executam comandos quando o helper remoto está atualizado.
- **Equipes de agentes.** Um roster com funções e regras, um quadro de quem está trabalhando ou esperando, um orquestrador que inicia e envia mensagens aos outros, e um registro do que eles dizem entre si e a você. Veja o [guia de equipes de agentes](../guides/agent-teams.md).
- **Memória e presença.** Inspecione e restaure o que os agentes lembram de um projeto, receba um aviso quando um agente em qualquer host aberto estiver esperando por você e acompanhe os agentes em execução no Notch opcional (alfa).

### O espaço de trabalho ao redor

- **Terminal.** PTY nativo com renderização WebGL, modos raw e em blocos, painéis, espaços e terminais privados.
- **Editor.** CodeMirror 6 com LSP opcional, autocompletar e edições com IA, Quick Open e busca e substituição com pré-visualização.
- **Git.** Controle de versão, histórico com grafo de commits, worktrees e commits assistidos por IA.
- **Ambientes.** Local, WSL, SSH, Docker, serial e RDP, com conexões salvas, túneis e um painel do servidor.
- **Pré-visualizações e ferramentas.** Pré-visualização de servidores de desenvolvimento locais (também por SSH), visualizadores de mídia e PDF, um cliente de API e um cliente MCP.
- **Companheiro no celular.** Um app Android em prévia que se pareia por QR code para acompanhar e conduzir sessões de IA pela sua rede local.

### Privado por padrão

Sem conta e sem telemetria do Voktty. As chaves dos provedores ficam no chaveiro do sistema, o acesso nativo ao sistema de arquivos é autorizado por espaço de trabalho, as ferramentas de arquivo da IA recusam caminhos secretos e toda ferramenta que altera algo pergunta antes, a menos que você conceda acesso total.

A lista completa de recursos está em [docs/features.md](../features.md) (em inglês).

## Instalação

Os instaladores mais recentes estão na página de [Releases](https://github.com/voktty/voktty/releases/latest). O Voktty se atualiza automaticamente por ela.

### Notas para Windows

- Detecção de shell: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL é um ambiente de workspace de primeira classe, não um subprocesso encapsulado.

### Notas para Linux

- **Arch / AUR:** `yay -S voktty-bin` ou `paru`. Acompanha a versão mais recente.
- **NixOS / Nix:** use o flake oficial com `nix profile install github:voktty/voktty` fora do NixOS. No NixOS, importe o flake e adicione `inputs.voktty.packages.${pkgs.system}.voktty` a `environment.systemPackages`. `nixosModules.voktty` também oferece uma configuração simplificada.
- **AppImage:** requer FUSE. Sem ele: `./Voktty_*.AppImage --appimage-extract-and-run`. Em caso de falhas no Wayland, tente `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Os pacotes `.deb` / `.rpm` usam a pilha GTK do sistema e costumam ser mais suaves.

## Configurar agentes e IA

1. **Agentes de programação.** Instale as CLIs de agentes que você usa (por exemplo Claude Code ou Codex) e faça login como de costume. O Voktty as encontra e usa o login delas. Para projetos SSH, instale-as no servidor.
2. **Modelos de API.** Abra as configurações e vá em **Modelos IA**, adicione um provedor com sua chave ou um endpoint personalizado, ou aponte o Voktty para um servidor local de LM Studio, MLX ou Ollama. Os modelos passam a aparecer no seletor do Harness, em **API**.
3. As chaves são gravadas no chaveiro do sistema via `keyring` e nunca em `localStorage`. No Linux, sem barramento de sessão ou Secret Service, o Voktty usa um arquivo privado de contingência com modo 0600.

## Compilar do código-fonte

**Pré-requisitos**

- Rust (stable), https://rustup.rs
- Node 20+ e [pnpm](https://pnpm.io)
- Pré-requisitos do Tauri para sua plataforma, https://tauri.app/start/prerequisites/

**Executar**

```bash
pnpm install
pnpm tauri dev          # desenvolvimento
pnpm tauri build        # pacote de produção
```

**Verificações**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # lint Rust igual ao CI
cd src-tauri && cargo nextest run --locked                           # ou: cargo test --locked
```

## Tecnologias

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui e Zustand.

## Como contribuir

Issues e PRs são bem-vindos. Relate problemas, sugira recursos ou envie pull requests. Consulte [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) e a [documentação de arquitetura](../README.md). A direção do projeto está no [roadmap](../../ROADMAP.md).

## Status da assinatura das plataformas

As builds preliminares atuais são geradas sem assinatura de código do sistema operacional nem notarização para Windows e macOS. O Windows SmartScreen e o macOS Gatekeeper podem mostrar avisos porque os instaladores e pacotes do aplicativo ainda não são reconhecidos como confiáveis por essas plataformas.

Esses avisos, por si só, não provam a existência de malware, mas instale apenas uma build baixada dos canais oficiais do Voktty depois de verificar seu checksum ou sua assinatura de release. A assinatura do atualizador do Voktty é independente da assinatura do sistema operacional e protege a autenticidade das atualizações somente quando a chave de release correspondente está configurada.

Os certificados das plataformas e a notarização serão adicionados antes da distribuição estável.

<br clear="left" />

## Origem e atribuição

O Voktty é um fork independente do Terax (Crynta), e seu Agent Harness deriva do MonoCode (MIT, de Nick). Nenhum dos autores é afiliado ao Voktty nem o endossa. Veja [NOTICE](../../NOTICE) e [LICENSE](../../LICENSE).

## Licença

Voktty é licenciado sob a Apache-2.0. Para informações sobre dependências, consulte a [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
