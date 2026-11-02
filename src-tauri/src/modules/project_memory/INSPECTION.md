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
stable local destination. It refreshes on window focus and after the management
dialog closes, without polling, instruction reads or recursive watches. Target
replacement removes the prior status immediately and suppresses late results.
At most 256 observers remain admitted, including retired native requests until
they settle and their exact resource-close operation is acknowledged. Failed
cleanup remains charged and is retried when another observer is created.

The typed client's `inspect` method uses the existing
`project_memory_discover` command with `inspectionOnly: true`. The optional flag
defaults to false, retaining the original existing-private-state discovery
contract. Inspection requires the same current native window, presentation and
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

Green means a valid marker was found with complete ancestry and no blocked
observations. It does not mean that an agent received memory, instruction trust
was accepted or context delivery is enabled. Confirmed absence is neutral;
incomplete, conflicting or inaccessible observations require review. Errors
never become absence. The panel retains separate trust, policy, conversation
preparation and delivery controls. Unsupported remote, WSL and Docker targets
remain explicit and do not invoke local inspection as a fallback.

Explicit document browsing uses the separate display-only contract described in
[DOCUMENTS.md](DOCUMENTS.md). Marker observation never starts that content read.
