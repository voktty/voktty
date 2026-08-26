# Internal terminal aliases

Voktty aliases are portable, structured command definitions owned by `voktty-cli`. They do not rewrite terminal input and never pass a reconstructed command to `eval`, `sh -c`, PowerShell script evaluation, or `cmd /c`.

## Configuration

The user file is `aliases.json` below the operating system configuration directory returned by the platform. Run `voktty alias path` to print the exact location or `voktty alias edit` to create and open it in Voktty.

The tracked schema is [`aliases.schema.json`](../schemas/aliases.schema.json). Version 1 supports:

- an executable and a token array of fixed arguments;
- enabled or disabled state;
- exact workspace and profile exclusions;
- a description shown by `voktty alias list`.

User definitions override preinstalled definitions with the same name. Native commands take precedence over direct launchers: Voktty does not generate a launcher when that name already resolves on the host `PATH`. The explicit `voktty alias run <name>` form remains unambiguous.

Arguments after the alias name are forwarded as operating system argument tokens. Voktty does not parse shell operators, substitute variables, expand globs, or concatenate arguments into command text.

The workspace context is `VOKTTY_ALIAS_WORKSPACE` when explicitly set, otherwise the current directory at execution time. The optional profile context is `VOKTTY_ALIAS_PROFILE`. Exclusion values are exact, case-sensitive matches, which keeps resolution deterministic and avoids implicit path globbing.

## Commands

```text
voktty alias list
voktty alias test <name> -- <args...>
voktty alias run <name> -- <args...>
voktty alias edit
voktty alias import <file>
voktty alias export <file> [--force]
```

`import` validates and merges aliases, with imported entries taking precedence. `export` contains user definitions only, so a file stays portable and does not duplicate preinstalled aliases. Changes are visible through the explicit CLI immediately; direct alias launchers are regenerated when Voktty next starts.

## Preinstalled `ipme`

`ipme` performs only a local routing lookup by default. It does not contact a service, persist an address, emit telemetry, or run at application startup.

```text
ipme
ipme --public
voktty ipme --public --json
```

The public lookup is explicit, uses HTTPS to `api.ipify.org`, validates the response as an IP address, limits it to 128 bytes, and has a three-second connection timeout and six-second total timeout. Closing or interrupting the CLI cancels the process. Offline failures explain that the connection should be checked and retried.

## Shell and remote support

On local Windows, Linux, and macOS hosts, Voktty generates validated launchers in its private per-process command directory. The same launchers are available to PowerShell, `cmd`, bash, zsh, and fish when those shells honor `PATH`.

WSL, SSH, and Docker sessions intentionally do not receive the host control token, host CLI path, or host launchers. In those environments an alias reports as unavailable unless a compatible `voktty-cli` and configuration are installed inside that environment. Voktty does not copy binaries, configuration, or credentials into remote filesystems automatically.
