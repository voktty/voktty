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

Handles contain a safe integer `id` and a random UUID-v4 `token`. Selection and
review tokens are independently generated UUIDs. A helper admits at most 64
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
or policy. An enabled session cannot override missing trust or `never` policy.
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
