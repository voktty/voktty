# Native session context preparation

`ProjectMemoryWorkspace::observe_context` reads configuration, instruction facts
and fingerprints, PROJECT and CONTEXT using only captured project authority.
It returns `ProjectContextObservation` without an installation identity or private
preferences and performs no writes. It shares the inventory, role validation,
schema checks and bounded fact assembly used by the legacy reader below, with
the same four-reader admission, 2 MiB batch limit, cancellation, secret-path and
root-identity checks. It does not resolve a delivery scope, bind a conversation
or authorize provider delivery.

## Project-owned session context

`MemoryContextSession::bind_project` and `MemoryWorkers::bind_project_context`
capture the execution directory, one ready ancestor memory root and the original
native read authority without an installation identity, global store or trust
review. The caller supplies the conversation lifetime. Metadata inspection alone
does not grant document reads. Missing or ambiguous scopes, blocked documents,
invalid roles and replaced directories refuse binding.

Project sessions use the shared native packet reader and 24 KiB renderer.
Each read rechecks both captured roots and the complete applicable scope before
and after gathering current instructions and factual content. Ordinary project
edits can appear in the next packet without a persistent trust update. A consumer
must compare its captured packet again before delivery; preparation is not proof
of provider acceptance. Changing the execution root or creating another applicable
kit cannot redirect a bound session. Scope and bytes are point-in-time checks.

The existing schema-1 result uses `manual` as its default policy label and reports
context preparation available and captures false. This label is not a stored
policy, fabricated instruction-trust receipt or tool permission. Project sessions
never open, modify, repair or inherit legacy global state.

Both project and legacy bindings below share the same process-wide 256-session
budget, four-worker admission, cancellation and physical-settlement ownership.
Dropping a session retires subsequent reads; pending jobs keep their slot until
settlement. Ready binding and read results recheck their original authority at
consumption. Independent sessions cannot retire or adopt one another.

The CLI consumes this shared project session for explicit initial-prompt launch.
Desktop and SSH conversation owners still use the legacy binding below pending
their IPC/RPC and presentation adaptation. No additional timer, watcher or provider
starts when a binding is idle.

## Legacy policy-bound session context

`MemoryContextSession::bind` and `MemoryWorkers::bind_context_session` consume an existing native
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

`MemoryContextSession::read` and `MemoryWorkers::session_context` prepare a fresh bounded `MemoryContextResult`.
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

Synchronous owners use the same binding constructor, process-wide session budget,
scope and policy checks, and packet builder without creating an async runtime.
They consume the original native review and retain the session until their exact
conversation ends. Synchronous reads hold native read permits and the discovery
deadline; the four-worker admission and response-retirement wrapper applies only
to worker calls. Retirement and dropping remain independent for each binding.
No synchronous call writes preferences, accepts instruction trust or starts a
provider. A prepared packet is not evidence of provider delivery.

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
The desktop exposes explicit opaque context resources through the native owner
contract. Standalone Linux CLI launches consume the project binding above for a
qualified initial user prompt; this does not establish provider acceptance or
managed resume. See [CLI control](../../../docs/architecture/cli-control.md).
SSH, WSL and Docker
must use their own qualified transports rather than this local reader. Native
Windows/macOS/Android runtime qualification remains pending.
