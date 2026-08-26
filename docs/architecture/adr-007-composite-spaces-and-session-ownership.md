# ADR-007: Composite spaces, stable tab identity and session ownership

## Status

Accepted.

## Context

Voktty currently uses `spaceId` both to group tabs visually and to select their workspace root, environment, authorization and Git context. Runtime tab ids are also regenerated during restoration. These two shortcuts prevent a tab from leaving a visual group while retaining its operational context and prevent a persisted layout from referring to the same resource across restarts.

The workspace must support a user-selected two, four, six or eight simultaneous tab resources without mounting a PTY or CodeMirror instance twice. Closing the composite view must reveal its members as individual tabs without closing them. Membership changes must produce a predictable balanced layout without leaving inaccessible empty regions or recursive visual containers.

File associations and repeated desktop launches add a related ownership problem. More than one application process must not restore and write the same session concurrently.

## Decision

Voktty models a visual space as a reversible composite tab backed by a binary renderer layout tree. A space with zero or one member remains valid. Its configurable maximum is 2, 4 (default), 6 or 8 members. The pure domain derives a flat adaptive grid from membership: one member fills the surface, two split it evenly, three use one full-height column plus two stacked members, four use a 2x2 grid, and larger sets use balanced stacked columns. Removing or closing a member collapses obsolete leaves and rebalances the remaining members. User-adjusted split ratios remain stable while membership does not change.

Every live tab has two identities:

- `id` is a numeric runtime handle and may change after restart.
- `tabKey` is a persistent resource identity and survives serialization.

Every tab also has a `workspaceScopeId` independent from visual membership. During migration, the existing `spaceId` remains as a compatibility adapter for the workspace scope. Visual membership is stored only in `ViewSpace`; it is not duplicated on the tab.

One `TabKey` may occupy at most one slot across all visual spaces. Moving a member is atomic: its previous slot becomes empty before the target space receives it. A normal Explorer or external file open stays standalone. Dropping a file or directory over an occupied view is an AI reference attachment, never a new split; empty slots reject resource drops. A standalone tab can be added from the Space menu or dropped over an occupied view when capacity exists, which rebalances the current composite without creating a nested view. Extracting a member never closes its resource, while closing a member performs resource guards in the imperative shell and then applies the same structural removal. Reordering from the Spaces menu rebuilds the effective visual order.

The tab bars project `StripEntry` into one visual item per composite space or one contiguous member block when expanded. `activeStripItem` and the derived active resource keep existing consumers on the focused member. The universal workspace renderer will later place each resource once under a stable parent; composite, expanded, focused and resized presentations change placement and visibility, not resource ownership.

## Renderer checkpoint

The composite presentation now uses `SpaceWorkspace` as the universal surface. Pure geometry functions walk the binary layout, produce normalized slot placements and split handles, enforce minimum slot sizes, and convert pointer coordinates back into the affected split ratio. `useSpaces` updates only that split node, so slot geometry and unrelated layout branches retain their identity.

Visible terminal capacity is validated before a composite activation or drop mutates state. `spacePaneBudget.ts` walks each member's internal `PaneTree`, deduplicates members, and caps the visible total at eight leaves, leaving one renderer-pool slot as operational margin. The existing pool and `DormantRing` policy continues to govern hidden leaves; the budget path is pure and does not add IPC, filesystem scans, or eager dependencies.

`WorkspaceSurface` passes placements to stable instances of the terminal, editor, preview, markdown, diff, history and RDP stacks. Resource keys remain the tab identity; membership changes only visibility and geometry. The universal layout is authoritative while a `ViewSpace` is composite. The legacy editor-group tree remains available for standalone editor mode, and `PaneTree` remains the internal subdivision of an individual terminal tab. A newly created empty space exposes one localized assignment surface; after the first member is assigned, the renderer follows the adaptive layout. Manual visual/native smoke remains a release checkpoint.

### Menu and visual lifecycle checkpoint

`SpaceSwitcher` consumes a derived menu model rather than treating the menu as an archive of closed tabs. It reports composite/expanded/empty presentation, member order, focused slot, free slots, layout preview, color and non-destructive tab state badges. Contextual actions for tabs and occupied slots can extract or move a member; actual member closure still crosses the existing dirty, locked and running-process guards. Slots have localized semantic names, focused slots expose non-color state, the workspace drop surface announces rejection in a live region, and resize handles expose keyboard shortcuts.

Deleting a visual space is an explicit confirmed structural operation. It moves every live member to an existing local fallback workspace, or creates that fallback when necessary, then removes both the visual definition and its workspace metadata without disposing the resources. Legacy persisted tombstone shells remain valid migration input but deletion removes them as well. Closing the composite strip item is different: it changes the presentation to expanded and reveals the same members as standalone strip entries without closing or moving them.

Voktty desktop will use one primary application instance. Cold startup, repeated invocation, file association events and CLI control will produce a shared launch-intention contract. Only a normal cold launch restores the last clean session. The primary instance is the sole session writer, and only a confirmed clean close promotes the next restorable snapshot.

`tauri-plugin-single-instance` is registered as the first desktop plugin. Every accepted invocation becomes a canonical `LaunchRequest` with a process-unique `requestId`, source, intention, canonical paths and source CWD. Rust keeps a bounded queue until React acknowledges each request. The same request may be observed through the bootstrap drain and the hot event, so both Rust and React deduplicate by `requestId`.

The startup matrix is fixed:

| Invocation | Intention | Result |
| --- | --- | --- |
| Cold without paths | `restoreLastSession` | Read only `lastCleanSession` |
| Cold with files | `openFilesOnly` | Clean context rooted at the first parent, no terminal, standalone pinned files |
| Cold with a directory | `openDirectoryOnly` | Clean context with one standalone terminal |
| Second invocation without paths | `newStandaloneTab` | Focus the primary window and create one terminal tab |
| Second invocation or `Opened` with files | `openFilesInCurrentSession` | Open or focus files without changing the active root, environment or visual membership |
| Control CLI open | `openFilesInCurrentSession` | Use the same frontend launch dispatcher while retaining the authenticated response channel |

The session store has two versioned envelopes. `workingCheckpoint` is diagnostic and never participates in normal boot. `lastCleanSession` is the only restorable value. Each envelope records `ownerInstanceId`, a monotonic `generation`, `savedAt`, `closedAt` and the v2 snapshot. A close guard serializes the current state and promotes it only after dirty-editor, locked-tab and busy-terminal guards allow exit. Window close, tray quit and operating-system exit requests converge on that operation. A failed promotion keeps the previous clean envelope and leaves Voktty open.

Snapshot v2 stores workspace contexts, stable tab identities, visual spaces, strip order, active selection, layout ratios and focused slots. Hydration repairs invalid ratios, duplicate identities, missing references, repeated layout ids and layouts beyond the current configured limit, then reconciles each live membership into its adaptive layout. Overflow is retained as standalone tabs. Nonserializable resources are omitted. Legacy workspace records are read-only input: each becomes one operational context and one visual space, with the active tab plus nearest neighbors composed and any overflow retained as standalone tabs.

## Consequences

Layout and lifecycle logic can be tested as dependency-free functions before React integration. Persisted layouts can refer to resources without relying on runtime ids. A tab can be extracted from a visual space without losing its workspace context. The adaptive layout removes dead regions after membership changes while preserving custom geometry during stable membership.

The transition temporarily carries both `spaceId` and `workspaceScopeId`. All creation, hydration and legacy workspace moves must keep them coherent until the old field is retired. Persistence requires a versioned migration in the next milestone.

Single-instance startup removes independent main windows from this design. Future secondary windows must be coordinated children of the primary process and share the same session owner.

Linux single-instance delivery uses the session D-Bus name derived from `dev.voktty`, ending in `.SingleInstance`. Debian, RPM and AppImage need no extra application permission. A future Snap or Flatpak package must allow owning that session-bus name and calling it from another invocation inside the same package; packaging must verify this before declaring file-association support.

## Rejected alternatives

- Native floating tear-off windows were rejected because they duplicate lifecycle, focus, renderer and session ownership problems without improving the core split workflow.
- Reusing runtime numeric ids in persisted layouts was rejected because they are intentionally regenerated during hydration.
- Storing visual membership directly on each tab and again in the layout was rejected because two authorities can diverge.
- Preserving empty slots after a member closes was rejected because it leaves dead regions and makes adaptive layout behavior depend on historical layout state.
- Allowing multiple application processes to compete for the session store was rejected because last-writer behavior cannot express a reliable last clean close.
