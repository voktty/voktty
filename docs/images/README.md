# Documentation images

This directory contains the official Voktty screenshots used by the README, architecture documentation, and screenshot gallery.

The images are documentation assets. They are not part of the application runtime and are not loaded during normal Voktty use. The maintained gallery is in [screenshots.md](../screenshots.md), and the main README links to these files with relative paths that work on GitHub and in local clones.

## Conventions

- Keep PNG files in this directory and use stable, descriptive names for new captures.
- Do not include keys, tokens, private paths, sensitive addresses, host names with user names, customer or client names, or personal data in a capture. Blur them before committing the file and keep the unblurred original outside the repository.
- Add descriptive alt text and update [screenshots.md](../screenshots.md) whenever the official gallery changes.
- Use these images only for documentation. Runtime visual resources belong in `public/` or in the relevant module.

## Current assets

| File | Feature | Description |
| --- | --- | --- |
| `harness-session-review.png` | Agent Harness | An agent session with its changes shown as a reviewable diff. |
| `ssh-project-terminal.png` | SSH projects | A remote file explorer beside a live terminal on the server. |
| `terminal-ai-chat.png` | AI chat | The floating AI chat over a terminal. |

## Use from Markdown

From a README in the repository root:

```md
![Voktty Agent Harness session](docs/images/harness-session-review.png)
```

From a document inside `docs/`:

```md
![Voktty SSH project terminal](images/ssh-project-terminal.png)
```

From a translated README inside `docs/readme/`:

```md
![Voktty AI chat](../images/terminal-ai-chat.png)
```
