# Project observations without private preferences

`ProjectMemoryWorkspace` captures an explicitly authorized native project root
without opening `LocalMemoryStore`, creating an installation identity or reading
private preferences. It is the project IO boundary for separating shared kit
initialization from persistent policy and instruction trust.

The native caller supplies `MemoryReadAccess`. Requested and resolved roots must
both be authorized. The reader keeps the shared secret-path restrictions,
qualified local filesystem checks, directory identity and root-instance checks.
Each observation revalidates the captured root and its current authority before
returning. Links, reparse points and document changes retain the existing native
reader's refusal behavior. A successful observation grants no write authority.

`observe_deployment` reads the embedded kit's fixed deployment inventory, including
the lock marker and explicitly selected root instruction links. It does not
enumerate or copy conversations or other user files. Reads retain the four-reader
process limit, cancellation, a maximum five-second phase, the 256 KiB native
per-file limit, a 128-path limit and a 1 MiB aggregate text limit. Blocked files
stay blocked rather than becoming absent or empty.

`observe_scope` uses the shared scope resolver and its original discovery deadline.
Its directory keys are generated for each observation. They are not persistent
project keys, installation identities or instruction-trust receipts. Missing
ancestor authorization remains an incomplete scope rather than permission to
initialize a nested project.

The persistent `LocalMemoryWorkspace` shares root capture, root revalidation and
bounded text collection with this reader. It continues to check its installation
and preference revision for persistent operations. Its publication journal,
migrations, trust and policy remain separate contracts.

This API only observes the project. It does not publish a kit, provide an IPC
command, enable a conversation or repair Windows ACLs. Desktop, CLI and SSH
initialization must retain native review ownership and explicit write authority
when they consume these observations.
