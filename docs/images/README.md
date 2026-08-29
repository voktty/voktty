# Documentation images

This directory contains the official Voktty screenshots used by the README, architecture documentation, and screenshot gallery.

The images are documentation assets. They are not part of the application runtime and are not loaded during normal Voktty use. The maintained gallery is in [screenshots.md](../screenshots.md), and the main README links to these files with relative paths that work on GitHub and in local clones.

## Conventions

- Keep PNG files in this directory and use stable, descriptive names for new captures.
- Do not include keys, tokens, private paths, sensitive addresses, or personal data in a capture.
- Add descriptive alt text and update [screenshots.md](../screenshots.md) whenever the official gallery changes.
- Use these images only for documentation. Runtime visual resources belong in `public/` or in the relevant module.

## Current assets

| File | Feature | Description |
| --- | --- | --- |
| `voktty_6LhZMEZPC6.png` | API Client | Request builder, response inspection, headers, and timings. |
| `voktty_E7ePo9A5ka.png` | Agent history | Searchable sessions, transcripts, recovery actions, and export. |
| `voktty_k5Xr4AqgSA.png` | Environments | Local, WSL, SSH, RDP, and serial targets. |
| `voktty_MAZn6eHFXb.png` | Editor and terminal | Code editor, terminal, AI panel, and file details on hover. |
| `voktty_vPOlZrpa70.png` | File explorer | Image preview and file metadata on hover. |

## Use from Markdown

From a README in the repository root:

```md
![Voktty API Client and Sandbox](docs/images/voktty_6LhZMEZPC6.png)
```

From a document inside `docs/`:

```md
![Voktty agent operational history](images/voktty_E7ePo9A5ka.png)
```

From a translated README inside `docs/readme/`:

```md
![Voktty file preview](../images/voktty_vPOlZrpa70.png)
```
