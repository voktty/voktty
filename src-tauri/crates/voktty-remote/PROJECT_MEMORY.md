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

| Operation | Required fields besides `operation` | Effect |
| --- | --- | --- |
| `open` | none | Reserve an empty presentation; no filesystem IO |
| `select` | `handle`, `path`, `revision`; optional `inspectAncestors` | Replace the original selection with a host-native directory inside the authenticated root |
| `clear` | `handle`, `revision` | Retire selection and all its reviews |
| `close` | `handle` | Release exactly that presentation |
| `inspect` | `handle`, `selection` | Read bounded markers without private state or instruction bodies |
| `discover` | `handle`, `selection` | Discover using existing private settings without initializing them |
| `initialize` | `handle`, `selection` | Explicitly prepare private host settings; no project writes or trust |
| `preview` | `handle`, `selection`, `revision`, `inputs`, `links` | Retain an exact native initialization review at the selected directory |
| `confirm` | `handle`, `selection`, `review` | Consume and publish that review after native revalidation |
| `cancel` | `handle`, `selection`, `revision` | Retire the matching initialization review or fence an earlier arrival |
| `documents` | `handle`, `selection`, `root` | Display the shared native document inventory for the expected root |
| `reviewTrust` | `handle`, `selection`, `revision`; optional `role` | Display native instructions and retain their exact review |
| `confirmTrust` | `handle`, `selection`, `review` | Accept only that native instruction review |
| `cancelTrust` | `handle`, `selection`, `revision` | Retire or fence a trust review |
| `reviewPolicy` | `handle`, `selection`, `revision`, `policy` | Retain a native `manual`, `always` or `never` policy review |
| `confirmPolicy` | `handle`, `selection`, `review` | Consume the exact policy review without granting trust or session consent |
| `cancelPolicy` | `handle`, `selection`, `revision` | Retire or fence a policy review |
| `contextOpen` | none | Reserve an empty context owner |
| `contextBind` | `handle`, `selection`, `review`, `context`, `mode` | Consume a fresh trust review and move its source into the context owner |
| `contextRead` | `context` | Recheck current scope, policy and trust before preparing a packet |
| `contextClose` | `context` | Retire only that context and release its resources |

Handles contain a positive unsigned 32-bit `id` and a random UUID-v4 `token`.
IDs increase without reuse; exhaustion rejects new resources with `limit`.
Selection and review tokens are independently generated UUIDs. A helper admits at most 64
combined presentations and contexts. Selection and review revisions increase
within their original owners and stay within JavaScript's safe integer range.
An invalid newer selection still retires the previous source. Confirmations
consume reviews, including when native revalidation or publication fails.
Cancellation cannot revive an older request. Native reviews retain their own
120-second lifetime and filesystem/preference revision checks.

The host resolves private storage through `dirs::data_local_dir()/dev.voktty`,
matching the standalone CLI. Clients cannot choose that path. Marker inspection
and empty resource reservation create neither that directory nor an identity.
Preparation is explicit. The shared store qualifies its local filesystem,
ownership, permissions and complete ancestor chain and retains process locks and
revision checks. Host and Desktop installations do not copy consent or trust.

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
must agree with that profile and contain the project root. Neither ambient
workspace selection nor a borrowed numeric session ID chooses the host. POSIX
host directories stay inside the captured root; this client does not support
WSL, Docker, serial or Windows SSH host paths. Local Desktop paths retain their
native commands. Unknown namespaces and older helpers fail without local IO.

Each client family owns a pooled helper lease and checks its capability and exact
session membership. Requests explicitly map the shared command DTOs into this
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

The shared panel can manually bind and separately enable memory for a captured
Harness conversation on a saved SSH project namespace. Selection matching uses
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
