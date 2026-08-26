<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>Espace de développement léger, axé sur le terminal et natif pour l'IA.</strong></p>
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

Voktty est un environnement de développement (ADE) léger, open source, axé sur le terminal et natif pour l'IA, construit avec Tauri 2 + Rust et React 19. Il réunit un backend PTY natif avec moteur de rendu WebGL, un panneau latéral d'IA agentique fonctionnant avec vos propres clés ou des modèles entièrement locaux, un éditeur de code, un explorateur de fichiers, une gestion de sources avec graphe Git et un panneau d'aperçu web. Environ 7-8 Mo sur le disque. Aucune télémétrie. Aucun compte.

## Captures d'écran

<table>
  <tr><td align="center"><img src="../images/voktty_0stHyTBbyY.png" alt="Espace de travail" /><br/><sub>Espace de travail Voktty avec fichiers et onglets</sub></td><td align="center"><img src="../images/voktty_ljubKqX22C.png" alt="Copilot du terminal" /><br/><sub>Copilot du terminal en langage naturel</sub></td></tr>
  <tr><td align="center"><img src="../images/voktty_kLd3UCiAji.png" alt="Thèmes" style="margin-top: 12px;"/><br/><sub>Thèmes personnalisés et préréglages</sub></td><td align="center"><img src="../images/voktty_kiAdbgrGGj.png" alt="Gestion de sources et graphe Git" style="margin-top: 12px;"/><br/><sub>Panneau de gestion de sources avec graphe Git</sub></td></tr>
  <tr><td colspan="2" align="center"><img src="../images/voktty_wiRVOca2A5.png" alt="Terminal" style="border-radius: 4px; margin-top: 12px;" /><br/><sub>Terminal avec informations système et explorateur</sub></td></tr>
</table>

## Fonctionnalités

### Terminal

- xterm.js avec moteur WebGL, plusieurs onglets et flux en arrière-plan
- Terminal par blocs accéléré par GPU avec saisie de commandes proche d'un éditeur
- Backend PTY natif via `portable-pty` (zsh, bash, pwsh, fish, cmd)
- Panneaux divisés horizontalement et verticalement
- Recherche intégrée, détection des liens et couleurs vraies
- Glissez des fichiers depuis l'explorateur ou le bureau sous forme de chemins protégés pour le shell
- Environnements par onglet sous Windows (Local ou toute distribution WSL installée)
- Spaces restaure onglets, répertoires de travail et dispositions entre les lancements

### Éditeur de code

- CodeMirror 6, compatible avec les langages courants comme TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON et Markdown
- Autocomplétion IA intégrée avec modèles locaux
- Diffs de modifications IA à accepter ou refuser bloc par bloc
- Serveurs de langage facultatifs avec diagnostics, navigation, complétion, formatage et serveurs personnalisés
- Markdown rendu et affichage des images, vidéos, fichiers audio et PDF
- Mode Vim
- Thèmes intégrés dont Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub et Xcode

### Gestion de sources

- Indexer ou désindexer des blocs, valider (Cmd+Enter / Ctrl+Enter) et pousser avec gestion de l'amont
- Affichage des branches, y compris l'état HEAD détaché
- Historique Git avec véritable graphe de commits et couloirs pour les fusions et branches
- Recherche et filtrage des commits avec accès à leur page distante

### Explorateur de fichiers

- Thème d'icônes Catppuccin
- Recherche approximative, navigation au clavier, renommage intégré et actions contextuelles
- Mise à jour en direct lorsque les fichiers changent sur le disque
- Ajout direct de fichiers et sélections au panneau latéral IA

### Aperçu web

- Détecte les serveurs locaux et les ouvre dans un onglet d'aperçu
- Aperçu d'URL externes via une vue web enfant native

### Thèmes et personnalisation

- Créez des thèmes dans l'application et alternez entre les préréglages et les vôtres
- Partagez vos thèmes ou importez ceux de la communauté
- Images de fond avec opacité et flou réglables
- Le thème de l'éditeur est indépendant de celui de l'application

### IA

- **Fournisseurs avec vos propres clés :** OpenAI, Anthropic, Google (Gemini), Groq, xAI (Grok), Cerebras, OpenRouter, DeepSeek, Mistral et tout endpoint compatible OpenAI
- **Local / hors ligne :** LM Studio, MLX, Ollama
- **Flux agentique :** plans, sous-agents, mémoire du projet via `VOKTTY.md`, lecture / écriture / modification / modifications multiples / grep / glob, bash soumis à approbation et processus en arrière-plan
- **Orchestration d'agents de programmation :** lancez Claude Code dans un terminal, inspectez sa sortie et envoyez des tâches de suivi via des outils soumis à approbation
- **Zone de saisie :** extraits de prompt avec `#handle`, fichiers avec `@path`, saisie vocale et pièces jointes depuis l'explorateur ou une sélection
- **Agents personnalisés** avec leur propre prompt système et sous-ensemble d'outils
- **Mode plan** qui génère un plan et demande confirmation avant d'agir

## Nouveautés actuelles de Voktty

- **Spaces composites plats :** les onglets autonomes restent séparés des Spaces nommés. Leurs membres peuvent être réordonnés de façon déterministe, avec 2, 4, 6 ou 8 vues et sans Spaces imbriqués.
- **IDE et débogage :** CodeMirror 6, navigation des symboles, panneau Problems, actions de code, complétion fantôme, modifications contrôlables par diff et débogage DAP lorsqu'un adaptateur compatible est configuré.
- **Client MCP sécurisé :** connexion de serveurs locaux stdio ou de serveurs distants Streamable HTTP. Les outils sont validés et les mutations demandent une autorisation native à usage unique.
- **Extensions natives :** les extensions JavaScript de `~/.voktty/extensions/` peuvent ajouter des commandes, raccourcis, outils IA, notifications et actions de workspace. Il s'agit de l'API Voktty, pas d'une compatibilité avec les extensions VS Code.
- **Collaboration terminal :** partage temporaire d'un terminal avec rôles observateur/contrôleur, chiffrement supplémentaire et citations de fichiers distants en lecture seule.
- **Connexions et performances :** les environnements Local, WSL, SSH, Docker et série exposent leur cycle de connexion ; les terminaux masqués libèrent les renderers coûteux sans arrêter les processus actifs.
- **Présence des agents :** avatars par rôle, icônes animées pour les agents externes et sons locaux optionnels pour les sauvegardes, Git, Problems, le débogage et les réponses des agents, avec prise en charge de la réduction des mouvements.

La liste complète et canonique des fonctionnalités se trouve dans le [README en anglais](../../README.md), avec les limites de sécurité et la disponibilité par plateforme.

## Installation

Les installateurs récents sont disponibles sur la page [Releases](https://github.com/voktty/voktty/releases/latest). Voktty s'y met à jour automatiquement.

### Notes Windows

- Détection du shell : `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL est un environnement de travail à part entière, pas un sous-processus encapsulé.

### Notes Linux

- **Arch / AUR :** `yay -S voktty-bin` ou `paru`. Suit la dernière version.
- **NixOS / Nix :** utilisez le flake officiel avec `nix profile install github:voktty/voktty` hors NixOS. Sous NixOS, importez le flake et ajoutez `inputs.voktty.packages.${pkgs.system}.voktty` à `environment.systemPackages`. `nixosModules.voktty` offre aussi une configuration simplifiée.
- **AppImage :** nécessite FUSE. Sans FUSE : `./Voktty_*.AppImage --appimage-extract-and-run`. En cas de défauts sous Wayland, essayez `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Les paquets `.deb` / `.rpm` utilisent la pile GTK du système et sont souvent plus fluides.

## Configurer l'IA

1. Ouvrez **Paramètres -> IA**.
2. Choisissez un fournisseur et collez votre clé API. Pour une inférence locale, indiquez votre endpoint LM Studio / MLX / Ollama.
3. Les clés sont enregistrées dans le trousseau du système via `keyring`. Elles ne sont jamais écrites sur le disque ni dans localStorage.

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

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK v6, Tailwind v4, shadcn/ui et Zustand.

## Contribuer

Les issues et PR sont les bienvenues. Signalez des problèmes, proposez des fonctionnalités ou envoyez une pull request. Consultez [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) et la [documentation d'architecture](../README.md).

## État de la signature des plateformes

Les builds préliminaires actuels sont créés sans signature de code du système d'exploitation ni notarisation pour Windows et macOS. Windows SmartScreen et macOS Gatekeeper peuvent afficher des avertissements, car les installateurs et les bundles de l'application ne sont pas encore reconnus comme fiables par ces plateformes.

Ces avertissements ne prouvent pas à eux seuls la présence d'un logiciel malveillant. Installez uniquement un build téléchargé depuis les canaux officiels de Voktty après avoir vérifié son checksum ou sa signature de release. La signature du programme de mise à jour Voktty est indépendante de la signature du système d'exploitation et ne protège l'authenticité des mises à jour que lorsque la clé de release correspondante est configurée.

Les certificats de plateforme et la notarisation seront ajoutés avant la distribution stable.

<br clear="left" />

## Licence

Voktty est distribué sous licence Apache-2.0. Pour plus d'informations sur les dépendances, consultez l'[Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
