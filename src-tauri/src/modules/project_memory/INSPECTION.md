# Project memory status observation

The shared footer follows the selected canonical terminal leaf or the focused
Harness view. Harness publishes a window-local source receipt with its project,
folder, environment and a conversation-capture callback. Publishing that receipt
starts no native work and captures no conversation. The footer checks the exact
view identity before using it; selection or environment departure retires the
receipt, including a round trip back to the same source. A replacement cannot
be removed by an earlier receipt's cleanup. Conversation capture remains an
explicit panel-opening action under the existing Harness session guards.

The indicator lazily loads its observer and waits 200 ms before inspecting a
stable destination. It refreshes on window focus and after the management
dialog closes, without polling, instruction reads or recursive watches. Target
replacement removes the prior status immediately and suppresses late results.
Closing a separate Harness rail panel also refreshes active indicators through a
window-local notification. It carries no path, observation or permission; each
indicator re-inspects its own current source under its existing authority.
At most 256 observers remain admitted, including retired native requests until
they settle and their exact resource-close operation is acknowledged. Failed
cleanup remains charged and is retried when another observer is created.

For local targets, the typed client's `inspect` method uses the existing
`project_memory_discover` command with `inspectionOnly: true`. Missing or false
flags are rejected before inspection; no private-state fallback exists.
Inspection requires the same current native window, presentation and
selection tokens as other memory operations. It never authorizes a directory,
opens private state, creates an installation identity or changes preferences.

`NativeMemorySource::inspect_scope` delegates to the shared
`inspect_local_memory_scope` reader through `MemoryWorkers`. It retains the
source's captured read authority, the shared four-job budget and a five-second
deadline. Close, source replacement, window retirement and application shutdown
retire delivery. Jobs keep their slots until actual settlement; cooperative
cancellation does not prove that an operating-system call was interrupted.

Only bounded metadata and `.voktty/kit.json` markers are inspected. Existing
secret-path, no-follow, canonical-root and local-filesystem checks still apply.
Parent directories outside the captured authority remain unknown unless their
narrow inspection has already been explicitly accepted for that selection.
The request does not expand those permissions or scan descendants. Its schema-1
reply is the existing `scope`, `root` and `blockedCount` envelope; instruction
bodies, raw facts, blocked paths, preferences and installation identity stay
native. Directory keys are observation-local, not persistent project identities.

The management panel uses that same state-free inspection for opening, refresh
and directory authorization recovery. Opening the panel requests the existing
bounded ancestor-marker inspection as part of selecting its captured directory,
without a separate permission screen. This does not read ancestor instructions,
authorize ancestor workspaces or grant writes. Refresh and continuation after
publication retain that exact selection. Unavailable or incomplete ancestry
remains explicit and blocks initialization; the panel offers an inspection retry
rather than treating unknown parents as absent. Background indicators retain
their own selections and request the same bounded ancestor-marker inspection.
This avoids reporting unknown ancestry solely because the indicator omitted
that inspection. It never grants ancestor instruction reads or writes. A valid
complete scope is green, absence is gray, and incomplete, invalid or unavailable
observations are orange. Harness rail and internal AI buttons use the same
observer; selected-source retirement and debounce remain unchanged.
Initialization uses project defaults without private-settings preparation;
replacements still require their exact file review. A private settings error
must not be presented as a reason to authorize the project again.
Native storage failures log the operation, first failing storage/security stage,
bounded error description and optional numeric Windows status. Diagnostics are
per operation and contain no paths, account identifiers, ACLs or document data.
The setup command preserves its existing error code and may also return
`storage: { stage, windowsError }`. The stage comes from the fixed native stage
enum and the optional Windows status is an unsigned 32-bit integer. The panel
validates both before displaying them beside the code; arbitrary OS messages
and storage paths are never displayed. Retired selections receive cancellation
without a diagnostic from their predecessor. This does not relax access checks.
For an existing kit, a trust or policy review that reports missing or unavailable
local settings offers that same explicit preparation action. Access denial,
invalid state and unsupported transports do not offer this recovery or change
the original authorization requirements.

Green means a valid marker was found with complete ancestry and no blocked
observations. It does not mean that an agent received memory, instruction trust
was accepted or context delivery is enabled. Confirmed absence is neutral;
an incomplete scope with exactly one observed kit has an orange indicator that
reports both the found memory and the need for review. It neither treats the
scope as usable nor retains the management panel's ancestor inspection grant.
Other incomplete, conflicting or inaccessible observations require review. Errors
never become absence. The normal panel shows the observation and its root.
Initialization is offered only for absence; existing ready memory keeps
maintenance and initial-capture instructions under More, alongside conversation
controls and directory metadata. Actual replacement and recovery conflicts still
require their native review. Explicit SSH workspaces and saved SSH project
namespaces use the shared client's independently leased `memory.manage` helper
transport; see its [contract](../../../crates/voktty-remote/PROJECT_MEMORY.md).
Unknown namespaces and unsupported WSL, Docker and serial targets remain explicit
and do not invoke local inspection as a fallback.

Explicit document browsing uses the separate display-only contract described in
[DOCUMENTS.md](DOCUMENTS.md). Marker observation never starts that content read.

## Opt-in command tracing

Set `VOKTTY_MEMORY_DIAGNOSTICS=1` before starting Desktop to trace local indicator
commands in the existing application log under `voktty::memory_inspection`.
The exact value `1` enables tracing; the first command caches that choice until
process exit. With tracing disabled, commands emit no diagnostic events.

Each opening, selection, inspection or close receives an independent numeric
trace ID. Events contain only the operation, fixed stage, elapsed milliseconds
and a `scope_closed` flag. They never include paths, resource tokens, selection IDs,
environment values, instruction bodies or kit configuration. A stage event is
emitted before entering that step. A final event records the last stage when
the command scope is released, including errors or future cancellation;
`scope_closed=true` proves neither success nor delivery of an IPC response. A missing
final event alone is not proof of a hang: process termination can omit it too.

`WorkerWait` means inspection was admitted and the command is waiting for native
work; it does not identify a particular filesystem call. `WindowOwner`,
`ResourceTable`, `Presentation` and `Selection` distinguish earlier ownership
steps. Capture thread stacks on the affected Windows build to determine why a
stage stops progressing. Tracing does not alter timeouts, authorization, work
budgets, cleanup or the automatic observation behavior, and is not a fix or
runtime qualification of the reported Windows freeze.
