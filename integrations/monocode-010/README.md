# MonoCode 0.10 integration audit

This directory pins the MonoCode history reviewed for the Voktty Harness integration. The inventory is a reproducible map of commits, changed paths, and same-name local candidates. A candidate or matching file does not establish behavioral parity.

The comparison uses only existing Git objects. It does not fetch, check out, or modify either repository. Isolated merge checks write temporary files outside both repositories and report conflict counts only; they do not produce code for integration.

Regenerate the inventory from a local MonoCode checkout:

```bash
node scripts/monocode/audit.mjs /path/to/monocode
```

Check whether the tracked inventory still matches the pinned revisions without writing files:

```bash
node scripts/monocode/audit.mjs /path/to/monocode --check
```

Update the pinned revisions in `manifest.json` only when a new review range is chosen. Keep functional decisions and exclusions in the active Spanish integration plan under `PROMPTS/planes/monocode-010/`.
