# Project memory helper contract

The authenticated protocol-2 handshake advertises `memory.manage`. Callers must
check that capability before sending requests. Older helpers remain unsupported;
neither a missing capability nor a failed request permits local filesystem IO.
The capability covers the native service described here. It does not by itself
connect the Desktop panel or confirm delivery to a model.

Requests use a strict, internally tagged `operation` object. Requests are capped
at 512 KiB and successful operation results at 8 MiB. Unknown operations, fields
and invalid parameter types fail before operation admission. Memory operation
results use a schema-1 envelope inside the ordinary protocol response:

```json
{"schema":1,"ok":true,"result":null}
```

Operation failures instead contain `ok: false` and an `error` with a bounded
`code`. Publication failures also include `changes` with the native publisher's
acknowledged relative paths and possible recovery files. Already published files
are preserved. Transport/protocol and malformed-request failures retain the
ordinary remote error envelope. Arbitrary OS messages, private storage paths,
installation identity and raw discovery facts are never included in errors.
Storage failures may additionally contain `storage: { stage, windowsError }`.
The stage is a fixed native storage/security stage and the nullable Windows
status is an unsigned 32-bit integer. Clients validate and copy only those two
fields, preserve the original error code and ignore unknown diagnostic values.
Older helpers without this optional field retain their existing error behavior.

| Operation | Required fields besides `operation` | Effect |
| --- | --- | --- |
| `open` | none | Reserve an empty presentation; no filesystem IO |
| `select` | `handle`, `path`, `revision`; optional `inspectAncestors` | Replace the original selection with a host-native directory inside the authenticated root |
| `clear` | `handle`, `revision` | Retire selection and all its reviews |
| `close` | `handle` | Release exactly that presentation |
| `inspect` | `handle`, `selection` | Read bounded markers without private state or instruction bodies |
| `preview` | `handle`, `selection`, `revision`, `inputs`, `links` | Retain an exact native initialization review at the selected directory |
| `confirm` | `handle`, `selection`, `review` | Consume and publish that review after native revalidation |
| `cancel` | `handle`, `selection`, `revision` | Retire the matching initialization review or fence an earlier arrival |
| `reviewRecovery` | `handle`, `selection`, `revision` | Review complete saved originals for missing targets at the selected directory |
| `confirmRecovery` | `handle`, `selection`, `review`, `digest` | Consume that exact review and restore only its missing targets |
| `cancelRecovery` | `handle`, `selection`, `revision` | Retire or fence the shared deployment review |
| `documents` | `handle`, `selection`, `root` | Display the shared native document inventory for the expected root |
| `reviewTrust` | `handle`, `selection`, `revision`; optional `role` | Display native instructions and retain their exact review |
| `confirmTrust` | `handle`, `selection`, `review` | Accept only that native instruction review |
| `cancelTrust` | `handle`, `selection`, `revision` | Retire or fence a trust review |
| `contextOpen` | none | Reserve an empty context owner |
| `contextBind` | `handle`, `selection`, `review`, `context`, `mode` | Consume a fresh trust review and move its source into the context owner |
| `contextBindProject` | `schema: 2`, `handle`, `selection`, `context` | Bind the captured project source without global storage or instruction trust |
| `contextRead` | `context` | Recheck the captured source and scope; legacy contexts also recheck policy and trust |
| `contextClose` | `context` | Retire only that context and release its resources |

Handles contain a positive unsigned 32-bit `id` and a random UUID-v4 `token`.
The former `discover`, `initialize`, `reviewPolicy`, `confirmPolicy` and `cancelPolicy`
operations are removed. They fail as `invalid_params` before operation admission,
resource allocation or private storage access. Project initialization uses
`preview` and `confirm` without a private setup step. The legacy storage reader
only opens existing state; it never creates an installation or preferences.

IDs increase without reuse; exhaustion rejects new resources with `limit`.
Selection and review tokens are independently generated UUIDs. A helper admits at most 64
combined presentations and contexts. Selection and review revisions increase
within their original owners and stay within JavaScript's safe integer range.
An invalid newer selection still retires the previous source. Confirmations
consume reviews, including when native revalidation or publication fails.
Cancellation cannot revive an older request. Native reviews retain their own
120-second lifetime and filesystem checks; private-state operations additionally
retain their preference revision checks.

Initialization and restoration share one deployment review slot and monotonic
revision per selection. A newer review invalidates the previous review even if
its preparation fails. Confirmation checks the review kind and exact token
before consuming it; an initialization token cannot restore originals and a
restoration token cannot publish initialization. A mismatched token or kind does
not consume the current review. A matching restoration confirmation consumes its
review even when its digest or native revalidation fails. Stale cancellation
cannot retire a newer review; a future cancellation fences earlier arrivals.

Initialization preview and confirmation use the project-owned native service
without opening private host storage. Valid persisted `kit.json` values take
precedence over caller defaults during repair; existing project content remains
unchanged and is rechecked before publication. Bounded ancestor inspection
rejects nested initialization beneath a known applicable memory root, without
granting parent writes. Publication retains its temporary
`.voktty/.initialization.json` record on interruption. Its recovery is pending;
the legacy recovery operations below do not consume that record. Schema-1
preview replies retain `isResuming: false` and `recoveryFiles: []` for current
clients. These fields do not claim global-journal resumption.

Recovery replies include `schema`, host-native `root`, `revision`, `review`,
native SHA-256 `digest` and one to three literal `entries` with relative `target`,
`backup` and full original `text`. The native journal binds the root instances,
installation and preferences; display data is not write authority. Restoration
uses the shared native recovery core with authority limited to creating exact
missing targets and consuming exact original backups beneath the original
authenticated workspace. It permits no replacements, directory creation,
arbitrary staging or secret paths. Success returns the normal publication
report; partial failure preserves acknowledged `changes`. Restoration leaves
the journal and preferences unchanged and never publishes the kit. Resuming
initialization requires fresh inspection, editable inputs, preview and separate
acceptance. The worker retains its existing lifetime, generation, queue and
output-settlement rules for all three operations. Older `memory.manage` helpers
may reject these additive operations; clients report the rejection without
falling back to Desktop IO.

The host and standalone CLI use the shared native origin resolver:
`dirs::data_local_dir()/app.voktty.voktty/project-memory`, matching Desktop on
that execution machine. They share its installation identity, preference
revisions and process locks. Clients cannot choose that path. Older helpers
and CLI builds used `dev.voktty/project-memory`. Any existing legacy entry,
including empty, corrupt, linked or inaccessible state, blocks private-state
operations with `legacyStateRequiresReview`; neither store is opened or created.
A linked, inaccessible or non-directory legacy application parent also blocks.
An ordinary legacy application directory without project-memory does not block.
Ordinary helper requests never move, merge or discard identity, policy, trust or
an interrupted journal. The CLI no longer exposes private storage migration.
Project-only initialization, recovery and context do not inspect either origin.
Existing qualified migration markers remain relevant only to legacy state
operations; they are not project authorization or consent from another machine.
Do not delete legacy state or a migration marker to bypass a refusal. See
[the native origin contract](../voktty-memory-local/ORIGIN.md). Marker inspection
and empty resource reservation create neither that directory nor an identity.
Preparation is explicit. The shared store qualifies its local filesystem,
ownership, permissions and complete ancestor chain and retains process locks and
revision checks. Origins are rechecked when opening state and before consuming
context or accepting a previously prepared private-state review. A late legacy conflict
consumes a matching private-state confirmation without performing its write.
Project initialization preview and publication are independent of that state. Stateless
inspection, document display, cancellation and exact resource cleanup remain
available. Host and Desktop on different machines do not copy consent or trust.

Ancestor inspection is a narrow, explicit choice for a selection. It permits
only ancestor metadata, immediate `.voktty` entry metadata/enumeration and
`.voktty/kit.json` reads outside the authenticated workspace. It never grants
instruction reads, workspace ownership or writes to an ancestor. Initialization
uses the shared native preview and publisher. Write authority is derived only
from the accepted plan's create, replace, staging and recovery requirements,
under the captured workspace and secret-path rules. Reserved data is preserved.

Context modes are `enabled`, `disabled` or `inherit`. Binding does not write trust
or policy. A successful binding returns `{"schema":1,"root":"/host/project"}`,
where `root` is the native bound memory root, which may be an authorized ancestor
of the selected directory. An enabled session cannot override missing trust or
`never` policy.
Context packets retain the shared 24 KiB limit and grant no capture permission.
Preparing or copying a packet is not provider acceptance or evidence of reading.
Binding transfers the original source out of the presentation, so closing the
panel does not close accepted context. Context close and successful rehandshake
retire the old resources; a new helper cannot adopt an earlier helper's receipts.

`contextBindProject` is the project-only alternative to the legacy review-bound
operation above. It requires schema 2 before admission, rejects unknown fields,
and consumes one binding attempt on an empty context. A failed admitted attempt
cannot reuse that context; close it and obtain a fresh opening. Success returns
`{ schema: 2, root, packet }` using the shared native project session. Selection
and context handles remain scoped to the authenticated helper incarnation and
workspace. The original source transfers out of the presentation only on success.

Reads on project-bound contexts do not resolve or open global memory storage.
Missing, inaccessible, corrupt or legacy private state remains untouched and
cannot block this path. Current project instructions and facts can appear in a
later packet without a stored trust update. Consumers still need original-source
and packet-freshness checks before delivery. Legacy contexts retain their old
private-origin, policy and trust checks. The frontend conversation panel uses
`contextBindProject`; incompatible replies fail with exact context cleanup and
no retry through legacy binding or Desktop IO. Older helpers can reject the new
operation without affecting their other existing operations.

The helper owns one lazy serial memory worker outside its interactive protocol
loop. Filesystem RPCs and terminal input do not wait for memory processing.
At most four memory requests, including queued, running and output-pending work,
remain admitted. A full queue returns `busy`; retirement does not release a slot
until its original work and output settle. An unused helper starts no memory
thread. Native state and review operations remain serialized on that worker.

Read/discovery controls retain their five/fifteen-second cooperative budgets
from admission, including queue time. Inspection uses five seconds. Rehandshake
retires the original generation immediately, cancels its controls and wakes the
worker for cleanup without waiting in the protocol loop. Queued retired or
expired work starts no native reads. A worker rechecks its generation before
output admission; packets from a retired generation cannot become a later
generation's result. Output already admitted cannot be retracted. Clients must
retain their own original-source guards through response and close settlement.

Closing or reselecting a presentation is applied in memory-request order; it
does not roll back an already admitted publication. Cooperative cancellation
does not interrupt a blocked OS syscall. Helper shutdown cancels queued/running
work and joins the exact worker through actual settlement before dropping its
state. A processor panic or observed output failure closes memory admission for
that helper, cancels remaining work and retires native state. No replacement
worker can adopt those resources; reconnecting creates a new helper owner.

Tests cover the native workflow and framed stdio using isolated project and
private directories. Those tests are not a real SSH or Desktop UI smoke test.

## Desktop client ownership

The shared memory manager and indicator route explicit SSH workspaces and saved
SSH project namespaces through this service. Namespace resolution captures its
saved project and profile before asynchronous work; an attached SSH descriptor
must agree with that profile and contain the project root, using the owned
helper's canonical root when the saved path is an alias. Neither ambient
workspace selection nor a borrowed numeric session ID chooses the host. POSIX
host directories stay inside the captured root; this client does not support
WSL, Docker, serial or Windows SSH host paths. Local Desktop paths retain their
native commands. Unknown namespaces and older helpers fail without local IO.

Each client family owns a pooled helper lease and checks its capability and exact
session membership. The lease's authenticated canonical root maps saved path
aliases into bounded host paths; a changed root permanently retires the source.
Requests explicitly map the shared command DTOs into this
protocol and validate response correlation, envelopes and size limits. Display
roots retain their original namespace; instruction bytes and digests are not
rewritten. Saved profile/project changes permanently retire namespace receipts,
including changes immediately reversed. Existing direct SSH descriptors remain
pinned to their original connection. A new helper cannot reuse old receipts.

An accepted context retains a separate owner on the same lease. Presentation
close cannot release that context's helper. Cleanup addresses the original
helper even after source retirement, waits for its admitted requests to settle,
and retains failed cleanup for exact retry. The final owner releases and closes
its lease without closing sibling consumers. Client families and outstanding
requests per family are each capped at 256, including retired unsettled work.

The shared panel uses one explicit action to bind project files and enable future
turns for a supported captured Harness conversation on a saved SSH project
namespace. It starts no model and requires no global trust review. Selection matching uses
the captured project, profile, connection and directory, rather than a POSIX
path alone. Namespace metadata and Harness environment changes retire the
conversation even when immediately reversed. The accepted context keeps its own
helper owner after presentation or originating-view closure.

Remote delivery additionally requires a provider context tied to its actual raw
child's captured source. Codex and Claude recheck that source around preparation
and acceptance; an existing process cannot receive a new host's memory merely
because its namespace string was reused. A child without that proof cannot take
remote memory. Local delivery keeps its existing local-selection contract.
Claude memory admissions verify stable CLI 2.1.312 or newer with `agent.probe`
on an owned helper before enabling replay input, then spawn using that same
captured connection, root and lease. Missing version support has no local probe
or unverified execution fallback. Probe cleanup retains unfinished work and
failed helper cleanup under the original child owner.

Preparation and enabling do not start a model or prove delivery. Codex requires
its turn RPC acknowledgement; Claude requires the exact replay echo and completed
write. Native Windows, real SSH and actual model reading remain runtime
acceptance requirements, independent of transport and provider-adapter tests.
