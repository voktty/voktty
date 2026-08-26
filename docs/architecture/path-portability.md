# Path portability

Voktty treats paths as properties of a workspace environment, not of the machine that built the application. Runtime code must not contain a developer account name or assume a fixed home directory.

## Path classes

| Class | Resolution owner | Examples |
| --- | --- | --- |
| Native home and application data | Rust through the `dirs` crate | Windows profile, macOS home, Linux home and cache |
| Native launch directory | Rust workspace resolver | Explicit existing cwd, home, safe launch snapshot, temp or filesystem root |
| Windows system tools | Rust from `SystemRoot` and executable discovery | `cmd.exe`, Windows PowerShell and WSL launcher |
| WSL paths | Workspace conversion helpers | POSIX home, `/mnt/<drive>` and WSL UNC transport paths |
| SSH and Docker paths | Authenticated remote transport | Remote home and container workdir |
| Documentation examples | Documentation only | Synthetic `devuser`, `example` or `me` identities |
| Test fixtures | Test contracts only | Synthetic Windows, macOS and Linux paths |

The `pnpm check:portable-paths` gate scans production TypeScript, JavaScript, Rust and operational scripts. It rejects absolute profile or home paths whose account segment is not an approved synthetic fixture identity. The gate runs as part of `pnpm test`.

## Platform evidence

Path conversion contracts cover Windows drive letters and separators, UNC and WSL conversion, and POSIX homes. A passing Windows run does not count as a macOS or Linux smoke. Those platforms are reported only when the application or CI job has actually executed there.
