# Native session context preparation

`MemoryWorkers::bind_context_session` consumes an existing native
`MemoryTrustReview` with an explicit `MemorySessionUse` choice. The review is
an immutable observation for display, separate from accepting instruction trust.
Binding repeats its scope, root identity, instruction fingerprint, configuration,
preference snapshot and two-minute expiry checks. It never writes trust, policy,
session state or project files. A consumed review cannot also accept trust.

`Inherit` applies the current local policy without a session override. `Enabled`
is a context-only session choice; `Disabled` suppresses even `always`. Neither
choice overrides `never`, unavailable authority or missing instruction trust.
Capture consent and capability are always false on this path.

The returned `MemoryContextSession` is native-only, non-cloneable and not
serializable. It retains the original execution and resolved memory workspaces,
their store and native read authority, reviewed configuration and fingerprint.
It does not retain copies of all instruction or factual text. Its internal UUID
identifies this allocation, never a Harness or provider conversation ID. The
caller must associate this owner with the exact originating conversation and
retire it before changing that conversation's execution context. A view ID,
path string or provider resume ID cannot establish that association.

`MemoryWorkers::session_context` prepares a fresh bounded `MemoryContextResult`.
It checks the original directory identities and complete ancestor scope, then
loads effective preferences for that root. The shared decision core evaluates
the local policy, session choice and trusted digest before instruction reads.
A denied decision returns no packet and does not read instruction bodies.
Marker/configuration reads needed for scope discovery still occur.

Allowed preparation reads current instructions and factual documents through
the existing bounded native reader. The shared packet builder hashes the actual
instructions and enforces its 24 KiB UTF-8 total, instruction pointers and
factual excerpts. Configuration changes reject the old binding. Changed
instructions suspend it even if a later trust choice accepts their new digest;
the consumer needs a freshly reviewed binding. Factual PROJECT/CONTEXT edits
remain readable without accepting new instructions. Scope and preferences are
checked again before the worker returns.

There are at most 256 native bindings process-wide, including binding admission,
retired reads and unconsumed results. Each blocking request also retains the
existing shared four-worker slot and original discovery deadline through actual
settlement. Dropping or retiring the session immediately rejects new reads and
pending result delivery. A read that already owns the binding keeps its capacity
until its physical worker and response have settled. Independent bindings never
adopt each other's authority or retirement. Keeping an idle binding starts no
timer, watcher or provider; workers run only for requested binding or reads.

Binding and read consumers also check the captured root authority after receiving
a ready worker result, so retirement before consumption cannot deliver that result.

These APIs prepare local context; they do not establish adapter support, provider
delivery, reading or comprehension. The capability in this decision denotes
native packet preparation only. The application must still capture and check
its actual consumer's capability and original lifetime immediately before
emission. Scope, bytes and preferences are point-in-time observations, not a
transaction against external writers or a promise to erase previously returned
text. An error or cancellation never rolls back filesystem work elsewhere.

The native application can reserve window contexts and transfer a panel's exact
source into its confirmed context. See the
[native owner contract](../../src/modules/project_memory/CONTEXT.md). A panel
retires sources it still owns; a promoted context requires its own release.
IPC resources, Harness/internal-agent/CLI consumers and visual activation remain
integration work. SSH, WSL and Docker
must use their own qualified transports rather than this local reader. Native
Windows/macOS/Android runtime qualification remains pending.
