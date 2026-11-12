<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>L'espace de travail où travaillent vos agents de code.</strong></p>
  <p><a href="https://voktty.dev">Site web</a> · <a href="https://voktty.dev/docs">Documentation</a> · <a href="https://github.com/voktty/voktty">Code source du site</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="version" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="téléchargements" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="plateforme" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.pt-BR.md">Português</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.id.md">Bahasa Indonesia</a> | <a href="README.hi.md">हिन्दी</a>
</p>

---

Voktty est un espace de travail de bureau open source pour les agents de programmation IA, construit avec Tauri 2, Rust et React 19. Son Agent Harness exécute Claude Code, Codex, Gemini (via Antigravity), Cursor, Grok, OpenCode, Pi et tout modèle accessible par API, sur des projets locaux et SSH, avec validations, revue des changements, mémoire de projet partagée et coordination d'équipe. Autour, on trouve un terminal natif, un éditeur de code, Git et des environnements locaux, WSL, SSH, Docker, série et bureau à distance. Sans compte, sans télémétrie. Les installeurs pèsent de 25 à 36 Mo (v1.0.27 ; l'AppImage Linux, environ 118 Mo).

## Captures d'écran

Les captures utilisent l'interface en espagnol ; d'autres sont dans la [galerie](../screenshots.md).

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness : un agent modifie un projet et ses changements apparaissent sous forme de diff à conserver ou annuler" /><br/><sub>Agent Harness : un agent modifie un projet et ses changements apparaissent sous forme de diff à conserver ou annuler</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="Projet SSH : fichiers distants à côté d'un terminal en direct sur le serveur" /><br/><sub>Projet SSH : fichiers distants à côté d'un terminal en direct sur le serveur</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="Chat IA flottant qui lit le répertoire, les commandes récentes et la sortie du terminal actif" /><br/><sub>Chat IA flottant qui lit le répertoire, les commandes récentes et la sortie du terminal actif</sub>
</p>

## Ce que vous obtenez

### Agents

- **Plusieurs agents, un seul endroit.** Des sessions Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode et Pi côte à côte, chacune avec sa propre CLI et sa propre connexion.
- **N'importe quel modèle d'API comme agent.** Les fournisseurs cloud, les endpoints personnalisés et les modèles locaux Ollama, LM Studio ou MLX peuvent lire, chercher, modifier et exécuter des commandes dans un projet, avec les mêmes contrôles d'espace de travail et de chemins secrets que le chat IA. La boucle de l'agent et votre clé restent sur votre machine.
- **Vous décidez jusqu'où ils vont.** Les sessions supervisées demandent avant chaque écriture ou commande ; l'accès complet ne demande rien. Les modifications apparaissent sous forme de diffs à conserver ou annuler.
- **Des agents sur vos serveurs.** Sur les projets SSH, Claude Code, Codex et OpenCode s'exécutent sur l'hôte et une connexion coupée ne les arrête pas. Les modèles d'API lisent, cherchent et modifient les fichiers distants, et exécutent des commandes quand l'assistant distant est à jour.
- **Des équipes d'agents.** Un roster avec rôles et règles, un tableau de qui travaille ou attend, un orchestrateur qui démarre et écrit aux autres, et un journal de ce qu'ils se disent et vous disent. Voir le [guide des équipes d'agents](../guides/agent-teams.md).
- **Mémoire et présence.** Inspectez et restaurez ce que les agents retiennent d'un projet, soyez notifié quand un agent sur un hôte ouvert vous attend, et suivez les agents en cours dans le Notch optionnel (alpha).

### L'espace de travail autour

- **Terminal.** PTY natif avec rendu WebGL, modes brut et par blocs, panneaux, espaces et terminaux privés.
- **Éditeur.** CodeMirror 6 avec LSP optionnel, complétion et modifications par IA, Quick Open, et recherche-remplacement avec aperçu.
- **Git.** Gestion de versions, historique avec graphe de commits, worktrees et commits assistés par IA.
- **Environnements.** Local, WSL, SSH, Docker, série et RDP, avec connexions enregistrées, tunnels et tableau de bord du serveur.
- **Aperçus et outils.** Aperçu des serveurs de développement locaux (aussi par SSH), visionneuses de médias et PDF, un client d'API et un client MCP.
- **Compagnon mobile.** Une application Android en préversion qui s'associe par code QR pour suivre et piloter les sessions IA sur votre réseau local.

### Privé par défaut

Sans compte et sans télémétrie Voktty. Les clés des fournisseurs sont dans le trousseau du système, l'accès natif au système de fichiers est autorisé par espace de travail, les outils de fichiers de l'IA refusent les chemins secrets, et tout outil qui modifie demande d'abord, sauf si vous accordez l'accès complet.

La liste complète des fonctionnalités se trouve dans [docs/features.md](../features.md) (en anglais).

## Installation

Les installateurs récents sont disponibles sur la page [Releases](https://github.com/voktty/voktty/releases/latest). Voktty s'y met à jour automatiquement.

### Notes Windows

- Détection du shell : `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL est un environnement de travail à part entière, pas un sous-processus encapsulé.

### Notes Linux

- **Arch / AUR :** `yay -S voktty-bin` ou `paru`. Suit la dernière version.
- **NixOS / Nix :** utilisez le flake officiel avec `nix profile install github:voktty/voktty` hors NixOS. Sous NixOS, importez le flake et ajoutez `inputs.voktty.packages.${pkgs.system}.voktty` à `environment.systemPackages`. `nixosModules.voktty` offre aussi une configuration simplifiée.
- **AppImage :** nécessite FUSE. Sans FUSE : `./Voktty_*.AppImage --appimage-extract-and-run`. En cas de défauts sous Wayland, essayez `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Les paquets `.deb` / `.rpm` utilisent la pile GTK du système et sont souvent plus fluides.

## Configurer les agents et l'IA

1. **Agents de programmation.** Installez les CLI d'agents que vous utilisez (par exemple Claude Code ou Codex) et connectez-vous comme d'habitude. Voktty les trouve et utilise leur propre connexion. Pour les projets SSH, installez-les sur le serveur.
2. **Modèles d'API.** Ouvrez les paramètres et allez dans **Modèles IA**, ajoutez un fournisseur avec sa clé ou un endpoint personnalisé, ou pointez Voktty vers un serveur local LM Studio, MLX ou Ollama. Les modèles apparaissent ensuite dans le sélecteur du Harness, sous **API**.
3. Les clés sont écrites dans le trousseau du système via `keyring` et jamais dans `localStorage`. Sous Linux, sans bus de session ni Secret Service, Voktty utilise un fichier de secours privé en mode 0600.

## Compiler depuis les sources

**Prérequis**

- Rust (stable), https://rustup.rs
- Node 20+ et [pnpm](https://pnpm.io)
- Prérequis Tauri pour votre plateforme, https://tauri.app/start/prerequisites/

**Exécution**

```bash
pnpm install
pnpm tauri dev          # développement
pnpm tauri build        # paquet de production
```

**Vérifications**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # lint Rust identique à la CI
cd src-tauri && cargo nextest run --locked                           # ou : cargo test --locked
```

## Technologies

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui et Zustand.

## Contribuer

Les issues et PR sont les bienvenues. Signalez des problèmes, proposez des fonctionnalités ou envoyez une pull request. Consultez [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) et la [documentation d'architecture](../README.md). La direction du projet est décrite dans la [feuille de route](../../ROADMAP.md).

## État de la signature des plateformes

Les builds préliminaires actuels sont créés sans signature de code du système d'exploitation ni notarisation pour Windows et macOS. Windows SmartScreen et macOS Gatekeeper peuvent afficher des avertissements, car les installateurs et les bundles de l'application ne sont pas encore reconnus comme fiables par ces plateformes.

Ces avertissements ne prouvent pas à eux seuls la présence d'un logiciel malveillant. Installez uniquement un build téléchargé depuis les canaux officiels de Voktty après avoir vérifié son checksum ou sa signature de release. La signature du programme de mise à jour Voktty est indépendante de la signature du système d'exploitation et ne protège l'authenticité des mises à jour que lorsque la clé de release correspondante est configurée.

Les certificats de plateforme et la notarisation seront ajoutés avant la distribution stable.

<br clear="left" />

## Origine et attribution

Voktty est un fork indépendant de Terax (Crynta), et son Agent Harness dérive de MonoCode (MIT, de Nick). Aucun des auteurs n'est affilié à Voktty ni ne l'approuve. Voir [NOTICE](../../NOTICE) et [LICENSE](../../LICENSE).

## Licence

Voktty est distribué sous licence Apache-2.0. Pour plus d'informations sur les dépendances, consultez l'[Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
