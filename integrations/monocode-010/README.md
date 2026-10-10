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

Records default to the `integrated` basis and cite local commits between `localBaseline` and the current HEAD. Use `basis: "preexisting"` when the adaptation predates that baseline; the verifier then requires each cited commit to be its ancestor and each mapped code and test path to exist in the pinned baseline tree.

Integrated commit mappings, MIT provenance, focused test selections, and coverage state live in `ports.json`. A port can cite one local commit or several when the adaptation landed in separate focused changes. Partial records list the behavior deferred for a later milestone. The verifier checks both Git histories and the upstream license. Its test runners are restricted to Vitest and a named cargo-nextest filter. Verify mappings without running tests:

```bash
node scripts/monocode/verify-ports.mjs /path/to/monocode
```

Verify the mappings and run each recorded test command:

```bash
node scripts/monocode/verify-ports.mjs /path/to/monocode --run-tests
```
