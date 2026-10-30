# Window-owned native memory context

The native application reserves context owners independently of presentations.
`open_context` creates one empty, window-bound receipt without filesystem access,
private-state initialization, a resolved root or a context packet. Empty owners
already occupy the shared 256-entry window-context budget. An IPC client must
obtain its resource handle before requesting binding so that cleanup never
depends on receiving a new identifier after instruction consent.

`NativeMemoryContextTarget` groups the exact context, presentation and selection
receipts. These native-only weak identities carry no caller-supplied filesystem
facts. `bind_context_session` requires an empty, unclaimed target and the exact
instruction review from that selection's current reservation. It delegates root,
configuration, fingerprint, preference and expiry checks to the bounded native
worker. The target records that operation's discovery control before returning
the job. A second admission returns `Busy` without replacing the incumbent.
An admitted failure leaves the opening reserved until explicit close; the caller
must obtain a fresh review before another attempt with a new opening.

The binding result is not a context receipt or a delivery acknowledgement.
Its prepared artifact retains the original target identity and source and review
guards. Closing the target cancels queued work; closing the panel, changing its
selection or reservation, or retiring the native window also prevents adoption.
The physical worker retains its existing capacity until actual settlement.
Ready results recheck the original target, source and review before returning.

`promote_context` consumes that artifact under the native owners lock. Only its
original, still-empty pending target can adopt it. It moves the selection's exact
`NativeMemorySource` into the window context, alongside the native context
binding. No registry grants are added or copied, no new path is selected, and no
context receipt is allocated after the asynchronous work. The original selection
loses its source and its deployment, trust and policy controls retire. The panel
must select again to continue management. Existing scoped command readers already
revalidate their original selection before publication. Primitive scope reads
can still finish while the transferred source lives, so their observation alone
never proves that the old presentation selection is current.

Closing or reselecting a presentation does not retire an admitted context.
`session_context` reads through the original native binding with fresh scope,
trust and policy checks, bounded instruction reads and the shared 24 KiB packet
builder. `context_root` is the reviewed display path. `is_context_current` reports
logical ownership, not current trust, filesystem identity or provider support.
Only a completed, allowed native read can return a packet.

`close_context` removes only its exact native receipt and is idempotent. A stale
close cannot remove a replacement, even for the same path or window label.
Window replacement, native destruction and application shutdown drop their
context owners, sources and bindings. Captured reads reject later delivery and
retain their physical binding slots through settlement. Other windows and
independent contexts keep their own resources. Closing memory context never
stops a Harness child, terminal, provider conversation or operating-system job.

Logical empty, opening and admitted owners share the application's 256-entry
budget. Native bindings, including retired reads, retain the separate process-wide
256-binding budget, and actual requests retain the existing four-worker budget.
Closing a logical opening cannot free a still-running worker or binding slot.
None of these operations writes session consent, trust or policy to disk, grants
capture permission, starts a model or changes the existing local-only reader.

Tauri resource commands, typed frontend clients, engine conversation ownership,
manual activation controls and Harness/internal-agent/CLI delivery remain to be
connected. A view, path or provider session string cannot stand in for the exact
engine conversation incarnation. The consumer must capture that identity before
awaiting and retire its known native resource if adoption is refused. Packet
preparation does not demonstrate provider delivery, reading or comprehension.
SSH, WSL, Docker and native platform runtime qualification retain their existing
unsupported or unverified states.
