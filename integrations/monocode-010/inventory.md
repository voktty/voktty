# MonoCode 0.10 integration inventory

Mechanical commit, path, text-comparison, and isolated merge inventory; it does not certify functional equivalence.

Base: `6bd432cada0f492f076cc93f7ccb3027f4ff7102`. Target: `d68bfa8768b2f7e61686a5925c8d26e20cf6cba0`. Voktty baseline: `3386eb48c4c60f6b3ae17d578a19afa1907337a1`.

Same-name candidates and text comparisons are triage only. No candidate does not prove that behavior is absent.

## Commits

| SHA | Change | Review category |
| --- | --- | --- |
| `929c45b3` | Add particle effect for session title updates | functional change or adaptation |
| `f4868d4e` | Add insertion animation for new sidebar sessions | functional change or adaptation |
| `3ab724d8` | Support live remaining-usage display in provider chip | functional change or adaptation |
| `ce656baf` | Add slide and reveal animations to linked work item panel | functional change or adaptation |
| `dcaba3dc` | Extract permissions to dedicated picker modal | functional change or adaptation |
| `45c9a222` | Animate pane entry from split edge | functional change or adaptation |
| `00d68d34` | Add activity timeline to PR/issue panels with commit interleaving | functional change or adaptation |
| `31fcb090` | Prevent model picker labels from truncating | functional change or adaptation |
| `fb55b255` | Add folder staging actions to Git changes panel | functional change or adaptation |
| `14cb1ed5` | Preserve descenders in explorer file names (#678) | functional change or adaptation |
| `6a5f7fa1` | Add `Back` to revisit earlier answers in the question panel (#688) | functional change or adaptation |
| `e188ff1e` | Add colorblind-friendly diff palettes and +/- line markers (#707) | functional change or adaptation |
| `e65ed823` | fix(files): open markdown diffs as source instead of preview (#660) | functional change or adaptation |
| `e9fd233b` | Detect npm-installed Pi agent via package manifest (#687) | functional change or adaptation |
| `a5410169` | Focus the model search once the flyout is on screen (#670) | functional change or adaptation |
| `c7de48fd` | fix(pi): discover models registered by extensions (#645) | functional change or adaptation |
| `32fb2d1a` | Merge remote-tracking branch 'origin/main' | merge; review parents |
| `e994afb8` | fix(gitlab): support merge request diffs on older instances (#723) | functional change or adaptation |
| `60102ab3` | Treat Git paths literally when staging folders | functional change or adaptation |
| `271b66de` | Merge branch 'main' of https://github.com/hardbeat920/monocode | merge; review parents |
| `dc6d0ef4` | Make diff stats resize to fit sidebar | functional change or adaptation |
| `56bae446` | Harden Composer file drop handling | functional change or adaptation |
| `7933972a` | Improve scroll stability and output reveal pacing | functional change or adaptation |
| `4361fdb6` | Stabilize GitChangesPanel folder action tests | functional change or adaptation |
| `22b48740` | Add searchable worktree creation to sidebar switcher | functional change or adaptation |
| `610550e4` | Move workspace actions into the sidebar header | functional change or adaptation |
| `990f1411` | Add soft fades to clipped tabs and scroll areas | functional change or adaptation |
| `807c70e0` | Release v0.7.1 | functional change or adaptation |
| `889ac206` | Paint macOS glass tint natively during resize | functional change or adaptation |
| `98da85ae` | Support async Codex agent questions | functional change or adaptation |
| `98845e58` | Stop the remote folder dialog from darkening the window (#733) | functional change or adaptation |
| `680e1ab9` | Keep IME composition intact in remote session composers (#741) | functional change or adaptation |
| `a6b4b1d0` | Open general new terminals in the active session's worktree (#732) | functional change or adaptation |
| `185b5005` | Fix editor diff gutter layout and Inbox PR overview diff colors (#759) | functional change or adaptation |
| `0bfa5c61` | Optimize streaming output, file indexes, and transcript rendering | functional change or adaptation |
| `01036472` | Improve modal layering and light-theme styling | functional change or adaptation |
| `3e05e032` | Preserve transcript scroll position during asynchronous updates | functional change or adaptation |
| `7eebfc17` | fix: preserve focused note title drafts (#769) | functional change or adaptation |
| `07f29c13` | fix(skills): raise the skill catalog cap from 300 to 5,000 (#750) | functional change or adaptation |
| `57366970` | Render Nerd Font prompt glyphs in the terminal (#767) | functional change or adaptation |
| `b74e803e` | Keep Pi extension status in one row per key (#760) | functional change or adaptation |
| `5aef8623` | Hide internal and legacy Copilot models from Pi/omp catalogs (#766) | functional change or adaptation |
| `850be653` | Add persistent Mono agents with memory and scheduled habits (#773) | new product feature; review coexistence |
| `80ba2c09` | Throttle GitHub polling and handle rate-limit backoff | functional change or adaptation |
| `9ccfc094` | Release v0.8.0 | functional change or adaptation |
| `de033ffa` | fix(monos): keep IME candidate selection from sending in Mono inputs (#790) | new product feature; review coexistence |
| `93ee54c8` | Add Mono permission controls to Details | new product feature; review coexistence |
| `de83c796` | Add MonoCode session lifecycle controls | new product feature; review coexistence |
| `432ac686` | Refine Mono activity display and completion handling | new product feature; review coexistence |
| `0f8e5688` | Preserve delivered follow-up replies during inline work | new product feature; review coexistence |
| `0b7a21fd` | Add Mono launched sessions panel and persistence | new product feature; review coexistence |
| `e5794cc0` | Use chatting icon for session toggle | functional change or adaptation |
| `d8902e73` | Add per-Mono session sidebar visibility | new product feature; review coexistence |
| `40aa9feb` | Add effort selection animations for other harnesses (#672) | functional change or adaptation |
| `dddefe45` | Stabilize host Vitest integration runs under load. (#683) | functional change or adaptation |
| `c2b479dd` | fix(codex): omit collaboration mode until a model is known (#771) | functional change or adaptation |
| `bdc2b64c` | Fix notes keeping an "untitled" slug after they get a real title (#788) | functional change or adaptation |
| `140c6e56` | Add floating Mono chat panel with menu bar integration | new product feature; review coexistence |
| `03ae2775` | Continue Mono replies after sessions complete | new product feature; review coexistence |
| `e79778cd` | Resize menu bar portrait and fix macOS 27 image visibility | functional change or adaptation |
| `b1660e76` | Fix ModelPicker type error from stale harness prop | functional change or adaptation |
| `53d91c82` | Fix macOS Clippy chunking warnings | functional change or adaptation |
| `3597485c` | Route ⌘W and ⌘T to the focused project terminal (#774) | functional change or adaptation |
| `eb14d1a9` | Fix Settings catalog refresh behind fallback models (#783) | functional change or adaptation |
| `88994864` | Default to masking account emails | functional change or adaptation |
| `4d24fd7e` | Add persisted artifacts with chat attachments and panels | new product feature; review coexistence |
| `9a7b6a25` | Release v0.9.0 | functional change or adaptation |
| `0ee745e9` | Remove accidental document preview mockup | distribution or documentation |
| `11b53974` | Add Mono rail to floating chats for switching and creating | new product feature; review coexistence |
| `c0d1fa0d` | Add menu bar icon visibility toggle | functional change or adaptation |
| `1c532697` | Add artifact sheet overlay in floating Mono chat | new product feature; review coexistence |
| `de9650ce` | Use host WebKitGTK in the Linux AppImage (#824) | distribution or documentation |
| `296d7fd0` | Stabilize chat history scrolling and add browser regression coverage (#818) | functional change or adaptation |
| `b9e2a13f` | Self-update the Linux AppImage (#825) | functional change or adaptation |
| `0eb2773e` | feat(opencode): support OpenCode 2.x servers (#434) | functional change or adaptation |
| `6c677052` | Fix Changes list file selection click target and latency (#830) | functional change or adaptation |
| `b6e0db8d` | Stabilize transcript scroll pinning and settled Mono turn headers | new product feature; review coexistence |
| `bbb91627` | Wrap active agent names in signature pills | functional change or adaptation |
| `514400dc` | Enable native macOS spell checking in chat composer (#829) | functional change or adaptation |
| `09238465` | Merge branch 'main' of https://github.com/hardbeat920/monocode | merge; review parents |
| `e92d8038` | Keep Mono Codex sessions ephemeral and rotate by context | new product feature; review coexistence |
| `3e157b75` | Clean up temporary provider sessions | functional change or adaptation |
| `daaad71c` | Hide scrollbars in Zen phase live content | functional change or adaptation |
| `004cab5b` | Add isolated Codex mono storage and rollout persistence | new product feature; review coexistence |
| `0b2c391f` | Fix Windows path links and file syncing | functional change or adaptation |
| `322fc2a0` | Fix Windows Codex directory junction creation | functional change or adaptation |
| `bf5a30dc` | Add keyboard navigation to the file tree | functional change or adaptation |
| `eb5f69a5` | Allow mono habits to run for up to one hour | new product feature; review coexistence |
| `8a63eb69` | Tone down settled turn agent names | functional change or adaptation |
| `b93b95a4` | Preserve remote sessions when opening local projects | functional change or adaptation |
| `43602cde` | Make the live activity ticker expandable | functional change or adaptation |
| `a3f6f8a4` | Release v0.10.0 | functional change or adaptation |
| `d4e40a97` | Add session changes panel for Mono diffs | new product feature; review coexistence |
| `d26871f2` | Add commit tab to Mono changes panel | new product feature; review coexistence |
| `5a3aef0e` | Allow editing commit message without staged files | functional change or adaptation |
| `6ec7c52e` | Allow editing commit message without selected files | new product feature; review coexistence |
| `7c4bb7e5` | Add Mono session sidebar folder preferences | new product feature; review coexistence |
| `fd107302` | Stop repeating a thought's first paragraph when its row is opened (#882) | functional change or adaptation |
| `829fede6` | Drop a reorder drag whose pointerup never arrived (#879) | functional change or adaptation |
| `51b561ba` | fix: keep markdown table columns readable (#876) | functional change or adaptation |
| `db006a4a` | Run the same codex the user's shell does (#878) | functional change or adaptation |
| `d68bfa87` | Improve rendering performance for large streamed Markdown fences (#863) | functional change or adaptation |

## Changed files

| Upstream path | Local candidates | Text comparison |
| --- | --- | --- |
| `.github/workflows/ci.yml` | none | no_candidate |
| `.github/workflows/release.yml` | none | no_candidate |
| `.gitignore` | none | no_candidate |
| `CHANGELOG.md` | none | no_candidate |
| `CONTRIBUTING.md` | none | no_candidate |
| `Cargo.lock` | none | no_candidate |
| `Cargo.toml` | none | no_candidate |
| `README.md` | none | no_candidate |
| `host/child-backend.test.ts` | none | no_candidate |
| `host/child-backend.ts` | none | no_candidate |
| `host/opencode-v2-transport.test.ts` | none | no_candidate |
| `host/process.test.ts` | none | no_candidate |
| `host/process.ts` | none | no_candidate |
| `host/vitest.config.ts` | none | no_candidate |
| `host/workspace.test.ts` | none | no_candidate |
| `host/workspace.ts` | none | no_candidate |
| `mono-chat.html` | none | no_candidate |
| `package-lock.json` | none | no_candidate |
| `package.json` | none | no_candidate |
| `playwright.config.ts` | none | no_candidate |
| `scripts/assert-appimage-host-libs.sh` | none | no_candidate |
| `scripts/install-linux-deps-debian.sh` | none | no_candidate |
| `scripts/release-channel.cjs` | none | no_candidate |
| `scripts/release-channel.test.cjs` | none | no_candidate |
| `scripts/repack-appimage.sh` | none | no_candidate |
| `src-tauri/Cargo.toml` | none | no_candidate |
| `src-tauri/src/artifacts.rs` | none | no_candidate |
| `src-tauri/src/codex_mono_store.rs` | none | no_candidate |
| `src-tauri/src/control_cli.rs` | none | no_candidate |
| `src-tauri/src/fs.rs` | `src-tauri/src/modules/harness/fs.rs` | different |
| `src-tauri/src/gitlab.rs` | `src-tauri/src/modules/harness/gitlab.rs` | different |
| `src-tauri/src/harness.rs` | `src-tauri/src/modules/harness/host.rs` | different |
| `src-tauri/src/lib.rs` | `src-tauri/src/lib.rs` | different |
| `src-tauri/src/macos.rs` | none | no_candidate |
| `src-tauri/src/menu.rs` | none | no_candidate |
| `src-tauri/src/mono.rs` | none | no_candidate |
| `src-tauri/src/mono_chat.rs` | none | no_candidate |
| `src-tauri/src/mono_chat/menu_bar.rs` | none | no_candidate |
| `src-tauri/src/mono_transcript.rs` | none | no_candidate |
| `src-tauri/src/notes.rs` | `src-tauri/src/modules/harness/notes.rs` | different |
| `src-tauri/src/quick_composer.rs` | `src-tauri/src/modules/quick_composer.rs` | different |
| `src-tauri/src/session_store.rs` | `src-tauri/src/modules/harness/session_store.rs` | different |
| `src-tauri/src/skills.rs` | `src-tauri/src/modules/harness/skills.rs` | different |
| `src-tauri/src/window.rs` | `src-tauri/src/modules/window.rs` | different |
| `src-tauri/tauri.conf.json` | none | no_candidate |
| `src/app/App.tsx` | `src/modules/harness/components/HarnessApp.tsx` | different |
| `src/app/hooks/useFloatingMono.test.ts` | none | no_candidate |
| `src/app/hooks/useFloatingMono.ts` | none | no_candidate |
| `src/app/hooks/useIdleSessionDetach.test.ts` | `src/modules/harness/hooks/useIdleSessionDetach.test.ts` | different |
| `src/app/hooks/useIdleSessionDetach.ts` | `src/modules/harness/hooks/useIdleSessionDetach.ts` | different |
| `src/app/hooks/useMonoHabits.test.ts` | none | no_candidate |
| `src/app/hooks/useMonoHabits.ts` | none | no_candidate |
| `src/app/model/harnessFlush.test.ts` | none | no_candidate |
| `src/app/model/harnessFlush.ts` | none | no_candidate |
| `src/app/model/quickLaunchSession.test.ts` | none | no_candidate |
| `src/app/model/quickLaunchSession.ts` | none | no_candidate |
| `src/app/model/updater.test.ts` | `src/modules/harness/lib/updater.test.ts` | different |
| `src/app/model/updater.ts` | `src/modules/harness/lib/updater.ts` | different |
| `src/app/model/updaterConfig.test.ts` | `src/modules/harness/lib/updaterConfig.test.ts` | different |
| `src/app/shell/MonoRailSection.test.ts` | none | no_candidate |
| `src/app/shell/MonoRailSection.tsx` | none | no_candidate |
| `src/app/shell/ProjectRail.tsx` | `src/modules/harness/chrome/ProjectRail.tsx` | different |
| `src/app/shell/SettingsRail.tsx` | `src/modules/harness/chrome/SettingsRail.tsx` | different |
| `src/app/shell/Sidebar.tsx` | `src/modules/harness/chrome/Sidebar.tsx` | different |
| `src/app/shell/SidebarRename.test.ts` | none | no_candidate |
| `src/app/shell/SidebarUpdate.test.ts` | none | no_candidate |
| `src/app/shell/TitleBar.tsx` | `src/modules/harness/chrome/TitleBar.tsx` | different |
| `src/app/shell/TitleBarMenu.test.ts` | none | no_candidate |
| `src/app/shell/TitleBarPaneDrop.test.ts` | none | no_candidate |
| `src/app/shell/TitleBarStatus.test.ts` | `src/modules/harness/chrome/TitleBarStatus.test.ts` | different |
| `src/app/shell/UsageProviderChip.test.ts` | `src/modules/harness/chrome/UsageProviderChip.test.ts` | different |
| `src/app/shell/UsageProviderChip.tsx` | `src/modules/harness/chrome/UsageProviderChip.tsx` | different |
| `src/features/agent-app/model/agentApp.test.ts` | `src/modules/agent-app/model/agentApp.test.ts` | different |
| `src/features/agent-app/model/agentApp.ts` | `src/modules/agent-app/model/agentApp.ts` | different |
| `src/features/agent-app/model/agentAppMemory.test.ts` | none | no_candidate |
| `src/features/agent-app/model/agentAppSoul.test.ts` | none | no_candidate |
| `src/features/agent-app/model/sessionConversation.test.ts` | `src/modules/agent-app/model/sessionConversation.test.ts` | different |
| `src/features/agent-app/model/sessionConversation.ts` | `src/modules/agent-app/model/sessionConversation.ts` | different |
| `src/features/artifacts/artifacts.test.ts` | none | no_candidate |
| `src/features/artifacts/artifacts.ts` | none | no_candidate |
| `src/features/artifacts/ui/ArtifactCard.tsx` | none | no_candidate |
| `src/features/artifacts/ui/ArtifactContent.tsx` | none | no_candidate |
| `src/features/artifacts/ui/ArtifactPanel.test.ts` | none | no_candidate |
| `src/features/artifacts/ui/ArtifactPanel.tsx` | none | no_candidate |
| `src/features/connections/model/remoteSessionTabs.test.ts` | none | no_candidate |
| `src/features/connections/model/remoteSessionTabs.ts` | none | no_candidate |
| `src/features/connections/ui/AddRemoteProjectDialog.tsx` | `src/modules/connections/ui/AddRemoteProjectDialog.tsx` | different |
| `src/features/files/editor/codeHighlightPlugin.test.ts` | `src/modules/harness/surfaces/codeHighlightPlugin.test.ts` | different |
| `src/features/files/editor/codeHighlightPlugin.ts` | `src/modules/harness/surfaces/codeHighlightPlugin.ts` | different |
| `src/features/files/editor/editorGit.gutter.test.ts` | none | no_candidate |
| `src/features/files/editor/editorGit.ts` | `src/modules/harness/surfaces/editorGit.ts` | different |
| `src/features/files/model/fileIndex.resume.test.ts` | none | no_candidate |
| `src/features/files/model/fileIndex.test.ts` | `src/modules/harness/lib/fileIndex.test.ts` | different |
| `src/features/files/model/fileIndex.ts` | `src/modules/harness/lib/fileIndex.ts` | different |
| `src/features/files/ui/FileEditor.tsx` | `src/modules/harness/surfaces/FileEditor.tsx` | different |
| `src/features/files/ui/FilePreview.tsx` | `src/modules/harness/chrome/FilePreview.tsx` | different |
| `src/features/files/ui/FileTree.test.ts` | `src/modules/harness/chrome/FileTree.test.ts` | different |
| `src/features/files/ui/FileTree.tsx` | `src/modules/harness/chrome/FileTree.tsx` | different |
| `src/features/inbox/hooks/useInboxUnseen.test.ts` | none | no_candidate |
| `src/features/inbox/hooks/useInboxUnseen.ts` | `src/modules/harness/hooks/useInboxUnseen.ts` | different |
| `src/features/inbox/model/githubTasks.repositories.test.ts` | none | no_candidate |
| `src/features/inbox/model/githubTasks.ts` | `src/modules/harness/lib/githubTasks.ts` | different |
| `src/features/inbox/model/githubWorkItemFreshness.test.ts` | `src/modules/harness/lib/githubWorkItemFreshness.test.ts` | different |
| `src/features/inbox/ui/InboxComments.test.ts` | `src/modules/harness/surfaces/InboxComments.test.ts` | identical |
| `src/features/inbox/ui/InboxComments.tsx` | `src/modules/harness/surfaces/InboxComments.tsx` | different |
| `src/features/inbox/ui/InboxDetail.polling.test.ts` | none | no_candidate |
| `src/features/inbox/ui/InboxPrChecks.test.ts` | none | no_candidate |
| `src/features/inbox/ui/InboxPrDiff.tsx` | `src/modules/harness/surfaces/InboxPrDiff.tsx` | different |
| `src/features/inbox/ui/InboxPrOverview.test.ts` | `src/modules/harness/surfaces/InboxPrOverview.test.ts` | identical |
| `src/features/inbox/ui/InboxPrOverview.tsx` | `src/modules/harness/surfaces/InboxPrOverview.tsx` | different |
| `src/features/inbox/ui/InboxView.tsx` | `src/modules/harness/surfaces/InboxView.tsx` | different |
| `src/features/monos/floatingMain.test.ts` | none | no_candidate |
| `src/features/monos/floatingMain.tsx` | none | no_candidate |
| `src/features/monos/hooks/useMonoTranscript.test.ts` | none | no_candidate |
| `src/features/monos/hooks/useMonoTranscript.ts` | none | no_candidate |
| `src/features/monos/model/floatingMono.test.ts` | none | no_candidate |
| `src/features/monos/model/floatingMono.ts` | none | no_candidate |
| `src/features/monos/model/mono.test.ts` | none | no_candidate |
| `src/features/monos/model/mono.ts` | none | no_candidate |
| `src/features/monos/model/monoActivity.test.ts` | none | no_candidate |
| `src/features/monos/model/monoActivity.ts` | none | no_candidate |
| `src/features/monos/model/monoBackground.test.ts` | none | no_candidate |
| `src/features/monos/model/monoBackground.ts` | none | no_candidate |
| `src/features/monos/model/monoCards.ts` | none | no_candidate |
| `src/features/monos/model/monoCompletionBatches.test.ts` | none | no_candidate |
| `src/features/monos/model/monoConversation.test.ts` | none | no_candidate |
| `src/features/monos/model/monoConversation.ts` | none | no_candidate |
| `src/features/monos/model/monoFiles.test.ts` | none | no_candidate |
| `src/features/monos/model/monoFiles.ts` | none | no_candidate |
| `src/features/monos/model/monoHabits.test.ts` | none | no_candidate |
| `src/features/monos/model/monoHabits.ts` | none | no_candidate |
| `src/features/monos/model/monoMemory.test.ts` | none | no_candidate |
| `src/features/monos/model/monoMemory.ts` | none | no_candidate |
| `src/features/monos/model/monoMessaging.test.ts` | none | no_candidate |
| `src/features/monos/model/monoMessaging.ts` | none | no_candidate |
| `src/features/monos/model/monoMigration.test.ts` | none | no_candidate |
| `src/features/monos/model/monoRoster.test.ts` | none | no_candidate |
| `src/features/monos/model/monoRotation.test.ts` | none | no_candidate |
| `src/features/monos/model/monoRotation.ts` | none | no_candidate |
| `src/features/monos/model/monoSessionCompletion.test.ts` | none | no_candidate |
| `src/features/monos/model/monoSessionCompletion.ts` | none | no_candidate |
| `src/features/monos/model/monoSpawnedSessions.test.ts` | none | no_candidate |
| `src/features/monos/model/monoSpawnedSessions.ts` | none | no_candidate |
| `src/features/monos/model/monoUsageLimit.test.ts` | none | no_candidate |
| `src/features/monos/model/monoUsageLimit.ts` | none | no_candidate |
| `src/features/monos/model/monoWorkspace.test.ts` | none | no_candidate |
| `src/features/monos/model/monoWorkspace.ts` | none | no_candidate |
| `src/features/monos/ui/ConfirmReset.tsx` | none | no_candidate |
| `src/features/monos/ui/FloatingMonoChat.motion.test.ts` | none | no_candidate |
| `src/features/monos/ui/FloatingMonoChat.test.ts` | none | no_candidate |
| `src/features/monos/ui/FloatingMonoChat.tsx` | none | no_candidate |
| `src/features/monos/ui/HabitPage.tsx` | none | no_candidate |
| `src/features/monos/ui/HabitRow.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoActivityPanel.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoActivityPanel.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoChangesPanel.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoComposer.ime.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoComposer.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoComposer.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoComposerFileDrop.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoDetails.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoDetails.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoFilePages.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoFilePages.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoHabits.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoHeader.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoIntro.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoIntro.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoPreferencesPage.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoProjectCommit.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoProjects.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoRailMascot.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoSessionsPanel.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoSessionsPanel.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoSettingsPage.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoSettingsPage.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoSidebar.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoStatus.tsx` | none | no_candidate |
| `src/features/monos/ui/MonoUsageLimitNotice.test.ts` | none | no_candidate |
| `src/features/monos/ui/MonoUsageLimitNotice.tsx` | none | no_candidate |
| `src/features/monos/ui/NewHabitPage.tsx` | none | no_candidate |
| `src/features/monos/ui/PanelStack.test.ts` | none | no_candidate |
| `src/features/monos/ui/PanelStack.tsx` | none | no_candidate |
| `src/features/monos/ui/monoPanelParts.tsx` | none | no_candidate |
| `src/features/notes/notes.test.ts` | `src/modules/harness/lib/notes.test.ts` | different |
| `src/features/notes/notes.ts` | `src/modules/harness/lib/notes.ts` | different |
| `src/features/notes/ui/NotesView.test.ts` | none | no_candidate |
| `src/features/notes/ui/NotesView.tsx` | `src/modules/harness/surfaces/NotesView.tsx` | different |
| `src/features/notifications/hooks/projectNotificationFlow.test.ts` | none | no_candidate |
| `src/features/projects/model/pixelMascots.test.ts` | none | no_candidate |
| `src/features/projects/model/pixelMascots.ts` | none | no_candidate |
| `src/features/projects/model/projectOpenRun.test.ts` | none | no_candidate |
| `src/features/projects/model/projectReturn.ts` | `src/modules/harness/lib/projectReturn.ts` | different |
| `src/features/projects/model/projectTerminal.test.ts` | `src/modules/harness/lib/projectTerminal.test.ts` | different |
| `src/features/projects/model/projectTerminal.ts` | `src/modules/harness/lib/projectTerminal.ts` | different |
| `src/features/projects/ui/PixelMascot.tsx` | none | no_candidate |
| `src/features/projects/ui/ProjectBackgroundDialog.test.ts` | none | no_candidate |
| `src/features/projects/ui/ProjectBackgroundDialog.tsx` | `src/modules/harness/chrome/ProjectBackgroundDialog.tsx` | different |
| `src/features/projects/ui/RemoveProjectDialog.tsx` | `src/modules/harness/chrome/RemoveProjectDialog.tsx` | different |
| `src/features/projects/ui/SearchableProjectPicker.tsx` | `src/modules/harness/chrome/SearchableProjectPicker.tsx` | different |
| `src/features/projects/ui/SearchableProjectPickerMonos.test.ts` | none | no_candidate |
| `src/features/providers/model/rateLimits.test.ts` | `src/modules/harness/lib/rateLimits.test.ts` | different |
| `src/features/providers/model/rateLimits.ts` | `src/modules/harness/lib/rateLimits.ts` | different |
| `src/features/quick-composer/model/quickComposer.ts` | `src/modules/quick-composer/model/quickComposer.ts` | different |
| `src/features/quick-composer/ui/QuickComposer.tsx` | `src/modules/quick-composer/ui/QuickComposer.tsx` | different |
| `src/features/quick-composer/ui/QuickModelSelector.test.ts` | `src/modules/quick-composer/ui/QuickModelSelector.test.ts` | different |
| `src/features/quick-composer/ui/QuickModelSelector.tsx` | `src/modules/quick-composer/ui/QuickModelSelector.tsx` | different |
| `src/features/quick-composer/ui/QuickPermissions.tsx` | `src/modules/quick-composer/ui/QuickPermissions.tsx` | different |
| `src/features/quick-composer/ui/QuickWorkspaceControls.tsx` | `src/modules/quick-composer/ui/QuickWorkspaceControls.tsx` | different |
| `src/features/quick-composer/ui/useQuickPickerMotion.ts` | `src/modules/quick-composer/ui/useQuickPickerMotion.ts` | different |
| `src/features/sessions/data/monoSessionStore.test.ts` | none | no_candidate |
| `src/features/sessions/data/sessionHistory.test.ts` | `src/modules/harness/lib/sessionHistory.test.ts` | different |
| `src/features/sessions/data/sessionHistory.ts` | `src/modules/harness/lib/sessionHistory.ts` | different |
| `src/features/sessions/data/sessionStore.test.ts` | `src/modules/harness/lib/sessionStore.test.ts` | different |
| `src/features/sessions/data/sessionStore.ts` | `src/modules/harness/lib/sessionStore.ts` | different |
| `src/features/sessions/data/sessionStoreRestore.test.ts` | none | no_candidate |
| `src/features/sessions/hooks/useBottomChatMotion.test.ts` | none | no_candidate |
| `src/features/sessions/hooks/useBottomChatMotion.ts` | none | no_candidate |
| `src/features/sessions/hooks/useFileDrop.ts` | none | no_candidate |
| `src/features/sessions/model/composerResize.test.ts` | `src/modules/harness/lib/composerResize.test.ts` | different |
| `src/features/sessions/model/composerResize.ts` | `src/modules/harness/lib/composerResize.ts` | different |
| `src/features/sessions/model/emojiMessage.test.ts` | none | no_candidate |
| `src/features/sessions/model/emojiMessage.ts` | none | no_candidate |
| `src/features/sessions/model/handoff.ts` | `src/modules/harness/lib/handoff.ts` | different |
| `src/features/sessions/model/liveAgents.test.ts` | `src/modules/harness/lib/liveAgents.test.ts` | different |
| `src/features/sessions/model/liveAgents.ts` | `src/modules/harness/lib/liveAgents.ts` | different |
| `src/features/sessions/model/messageQueue.test.ts` | `src/modules/harness/lib/messageQueue.test.ts` | different |
| `src/features/sessions/model/messageQueue.ts` | `src/modules/harness/lib/messageQueue.ts` | different |
| `src/features/sessions/model/monoWorkStatus.test.ts` | none | no_candidate |
| `src/features/sessions/model/monoWorkStatus.ts` | none | no_candidate |
| `src/features/sessions/model/monocodeToolCall.test.ts` | none | no_candidate |
| `src/features/sessions/model/monocodeToolCall.ts` | none | no_candidate |
| `src/features/sessions/model/queuedFollowUp.test.ts` | none | no_candidate |
| `src/features/sessions/model/queuedFollowUp.ts` | none | no_candidate |
| `src/features/sessions/model/session.ts` | `src/modules/harness/lib/session.ts` | different |
| `src/features/sessions/model/sessionRemoval.test.ts` | `src/modules/harness/lib/sessionRemoval.test.ts` | different |
| `src/features/sessions/model/sessionRemoval.ts` | `src/modules/harness/lib/sessionRemoval.ts` | different |
| `src/features/sessions/model/transcriptActivity.test.ts` | `src/modules/harness/surfaces/transcriptActivity.test.ts` | different |
| `src/features/sessions/model/transcriptActivity.ts` | `src/modules/harness/surfaces/transcriptActivity.ts` | different |
| `src/features/sessions/model/transcriptTurnCache.test.ts` | none | no_candidate |
| `src/features/sessions/model/transcriptTurnCache.ts` | none | no_candidate |
| `src/features/sessions/model/usageLimit.test.ts` | none | no_candidate |
| `src/features/sessions/model/usageLimit.ts` | none | no_candidate |
| `src/features/sessions/ui/AccessPicker.tsx` | `src/modules/harness/chrome/AccessPicker.tsx` | different |
| `src/features/sessions/ui/AgentMarkdown.tsx` | `src/modules/harness/surfaces/AgentMarkdown.tsx` | different |
| `src/features/sessions/ui/AgentTranscript.copy.test.ts` | `src/modules/harness/surfaces/AgentTranscript.copy.test.ts` | different |
| `src/features/sessions/ui/AgentTranscript.habits.test.ts` | none | no_candidate |
| `src/features/sessions/ui/AgentTranscript.inlineWork.test.ts` | none | no_candidate |
| `src/features/sessions/ui/AgentTranscript.performance.test.ts` | none | no_candidate |
| `src/features/sessions/ui/AgentTranscript.test.ts` | `src/modules/harness/surfaces/AgentTranscript.test.ts` | different |
| `src/features/sessions/ui/AgentTranscript.tsx` | `src/modules/harness/surfaces/AgentTranscript.tsx` | different |
| `src/features/sessions/ui/AgentTranscriptPacing.test.ts` | none | no_candidate |
| `src/features/sessions/ui/AgentTranscriptScroll.test.ts` | none | no_candidate |
| `src/features/sessions/ui/AttachmentChip.tsx` | `src/modules/harness/chrome/AttachmentChip.tsx` | different |
| `src/features/sessions/ui/Composer.ime.test.ts` | none | no_candidate |
| `src/features/sessions/ui/Composer.tsx` | `src/modules/harness/chrome/Composer.tsx` | different |
| `src/features/sessions/ui/ComposerFileDrop.test.ts` | none | no_candidate |
| `src/features/sessions/ui/HighlightedCodeBlock.tsx` | none | no_candidate |
| `src/features/sessions/ui/MarkdownModeToggle.tsx` | `src/modules/harness/chrome/MarkdownModeToggle.tsx` | different |
| `src/features/sessions/ui/MarkdownSourceEditor.tsx` | none | no_candidate |
| `src/features/sessions/ui/MessageQueue.test.ts` | none | no_candidate |
| `src/features/sessions/ui/MessageQueue.tsx` | none | no_candidate |
| `src/features/sessions/ui/ModelPicker.test.ts` | `src/modules/harness/chrome/ModelPicker.test.ts` | different |
| `src/features/sessions/ui/ModelPicker.tsx` | `src/modules/harness/chrome/ModelPicker.tsx` | different |
| `src/features/sessions/ui/MonoWorkTicker.test.ts` | none | no_candidate |
| `src/features/sessions/ui/MonoWorkTicker.tsx` | none | no_candidate |
| `src/features/sessions/ui/QuestionForm.test.ts` | `src/modules/harness/chrome/QuestionForm.test.ts` | different |
| `src/features/sessions/ui/QuestionForm.tsx` | `src/modules/harness/chrome/QuestionForm.tsx` | different |
| `src/features/sessions/ui/SessionPane.tsx` | `src/modules/harness/surfaces/SessionPane.tsx` | different |
| `src/features/sessions/ui/SessionPaneMessaging.test.ts` | none | no_candidate |
| `src/features/sessions/ui/SessionPaneScroll.test.ts` | none | no_candidate |
| `src/features/sessions/ui/SessionReview.tsx` | `src/modules/harness/chrome/SessionReview.tsx` | different |
| `src/features/sessions/ui/TranscriptFind.test.ts` | none | no_candidate |
| `src/features/sessions/ui/TranscriptFind.tsx` | none | no_candidate |
| `src/features/sessions/ui/TranscriptJumpToBottom.tsx` | none | no_candidate |
| `src/features/sessions/ui/TranscriptPool.test.ts` | none | no_candidate |
| `src/features/sessions/ui/TranscriptPool.tsx` | none | no_candidate |
| `src/features/sessions/ui/UsageLimitNotice.tsx` | none | no_candidate |
| `src/features/sessions/ui/streamingMarkdown.test.ts` | none | no_candidate |
| `src/features/sessions/ui/streamingMarkdown.ts` | none | no_candidate |
| `src/features/sessions/ui/wordFade.test.ts` | none | no_candidate |
| `src/features/sessions/ui/wordFade.tsx` | none | no_candidate |
| `src/features/settings/model/appShortcuts.test.ts` | none | no_candidate |
| `src/features/settings/model/appShortcuts.ts` | none | no_candidate |
| `src/features/settings/model/appearance.test.ts` | `src/modules/harness/lib/appearance.test.ts` | different |
| `src/features/settings/model/appearance.ts` | `src/modules/harness/lib/appearance.ts` | different |
| `src/features/settings/model/displayPrefs.test.ts` | `src/modules/harness/lib/displayPrefs.test.ts` | different |
| `src/features/settings/model/displayPrefs.ts` | `src/modules/harness/lib/displayPrefs.ts` | different |
| `src/features/settings/model/nativeGlass.test.ts` | none | no_candidate |
| `src/features/settings/model/settings.flags.test.ts` | none | no_candidate |
| `src/features/settings/model/settings.test.ts` | `src/modules/harness/lib/settings.test.ts` | different |
| `src/features/settings/model/settings.ts` | `src/modules/harness/lib/settings.ts` | different |
| `src/features/settings/ui/SettingsView.test.ts` | `src/modules/harness/surfaces/SettingsView.test.ts` | different |
| `src/features/settings/ui/SettingsView.tsx` | `src/modules/harness/surfaces/SettingsView.tsx` | different |
| `src/features/source-control/ui/GitChangesPanel.test.ts` | none | no_candidate |
| `src/features/source-control/ui/GitChangesPanel.tsx` | none | no_candidate |
| `src/features/source-control/ui/SessionChangesDiff.tsx` | `src/modules/harness/surfaces/SessionChangesDiff.tsx` | different |
| `src/features/source-control/ui/SidebarWorktreeSwitcher.test.ts` | `src/modules/harness/chrome/SidebarWorktreeSwitcher.test.ts` | different |
| `src/features/source-control/ui/SidebarWorktreeSwitcher.tsx` | `src/modules/harness/chrome/SidebarWorktreeSwitcher.tsx` | different |
| `src/features/source-control/ui/SwitchBranchDialog.tsx` | `src/modules/harness/chrome/SwitchBranchDialog.tsx` | different |
| `src/features/source-control/ui/UnifiedDiffView.markers.test.ts` | none | no_candidate |
| `src/features/source-control/ui/UnifiedDiffView.tsx` | `src/modules/harness/surfaces/UnifiedDiffView.tsx` | different |
| `src/features/terminal/model/terminalTab.test.ts` | `src/modules/harness/lib/terminalTab.test.ts` | different |
| `src/features/terminal/model/terminalTab.ts` | `src/modules/harness/lib/terminalTab.ts` | different |
| `src/features/terminal/ui/ProjectTerminalDock.tsx` | `src/modules/harness/surfaces/ProjectTerminalDock.tsx` | different |
| `src/features/terminal/ui/TerminalView.test.ts` | none | no_candidate |
| `src/features/terminal/ui/TerminalView.tsx` | `src/modules/harness/surfaces/TerminalView.tsx` | different |
| `src/features/workspace/ui/PaneTree.tsx` | `src/modules/harness/surfaces/PaneTree.tsx` | different |
| `src/features/workspace/ui/PaneTreeEnter.test.ts` | `src/modules/harness/surfaces/PaneTreeEnter.test.ts` | different |
| `src/features/workspace/ui/SurfaceTabs.tsx` | `src/modules/harness/chrome/SurfaceTabs.tsx` | different |
| `src/features/workspace/ui/TabCloseMotion.test.ts` | none | no_candidate |
| `src/features/workspace/ui/TabMiddleClick.test.ts` | none | no_candidate |
| `src/integrations/harness/core/apply.test.ts` | `src/modules/harness/lib/harness/apply.test.ts` | different |
| `src/integrations/harness/core/apply.ts` | `src/modules/harness/lib/harness/apply.ts` | different |
| `src/integrations/harness/core/child.ts` | `src/modules/harness/lib/harness/child.ts` | different |
| `src/integrations/harness/core/registry.test.ts` | `src/modules/harness/lib/harness/registry.test.ts` | different |
| `src/integrations/harness/core/registry.ts` | `src/modules/harness/lib/harness/registry.ts` | different |
| `src/integrations/harness/core/types.ts` | `src/modules/harness/lib/harness/types.ts` | different |
| `src/integrations/harness/index.ts` | `src/modules/agent-app/index.ts`, `src/modules/agents/index.ts`, `src/modules/ai/index.ts`, `src/modules/api-client/index.ts`, `src/modules/collab/index.ts`, `src/modules/command-palette/index.ts`, `src/modules/connections/index.ts`, `src/modules/control/index.ts`, `src/modules/docker/index.ts`, `src/modules/editor/index.ts`, `src/modules/explorer/index.ts`, `src/modules/extensions/index.ts`, `src/modules/git-history/index.ts`, `src/modules/git-review/index.ts`, `src/modules/harness/index.ts`, `src/modules/harness/lib/harness/index.ts`, `src/modules/harness/mcp/index.ts`, `src/modules/header/index.ts`, `src/modules/i18n/index.ts`, `src/modules/launcher/index.ts`, `src/modules/lsp/index.ts`, `src/modules/markdown/index.ts`, `src/modules/mcp/index.ts`, `src/modules/mobile/index.ts`, `src/modules/notes-board/index.ts`, `src/modules/notifications/index.ts`, `src/modules/onboarding/index.ts`, `src/modules/orchestration/index.ts`, `src/modules/preview/index.ts`, `src/modules/quick-composer/index.ts`, `src/modules/quick-open/index.ts`, `src/modules/quota/index.ts`, `src/modules/rdp/index.ts`, `src/modules/remote/index.ts`, `src/modules/serial/index.ts`, `src/modules/settings/index.ts`, `src/modules/shortcuts/index.ts`, `src/modules/sidebar/index.ts`, `src/modules/skills/index.ts`, `src/modules/sound/index.ts`, `src/modules/source-control/index.ts`, `src/modules/spaces/index.ts`, `src/modules/ssh/index.ts`, `src/modules/ssh/tunnels/index.ts`, `src/modules/statusbar/index.ts`, `src/modules/tabs/index.ts`, `src/modules/terminal/index.ts`, `src/modules/theme/index.ts`, `src/modules/theme/skins/index.ts`, `src/modules/theme/themes/index.ts`, `src/modules/updater/index.ts`, `src/modules/vault/index.ts`, `src/modules/workbench/index.ts`, `src/modules/workspace-edit/index.ts`, `src/modules/workspace-search/index.ts`, `src/modules/workspace/index.ts` | ambiguous |
| `src/integrations/harness/providers/claude/claude.ts` | `src/modules/harness/lib/harness/claude.ts` | different |
| `src/integrations/harness/providers/codex/codex.ts` | `src/modules/harness/lib/harness/codex.ts` | different |
| `src/integrations/harness/providers/codex/codexApprovalUi.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/codex/codexLive.test.ts` | `src/modules/harness/lib/harness/codexLive.test.ts` | different |
| `src/integrations/harness/providers/codex/codexProtocol.test.ts` | `src/modules/harness/lib/harness/codexProtocol.test.ts` | different |
| `src/integrations/harness/providers/codex/codexProtocol.ts` | `src/modules/harness/lib/harness/codexProtocol.ts` | different |
| `src/integrations/harness/providers/codex/codexQuestions.test.ts` | `src/modules/harness/lib/harness/codexQuestions.test.ts` | different |
| `src/integrations/harness/providers/codex/codexQuestions.ts` | `src/modules/harness/lib/harness/codexQuestions.ts` | different |
| `src/integrations/harness/providers/codex/codexStore.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/codex/codexStore.ts` | none | no_candidate |
| `src/integrations/harness/providers/codex/codexText.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/codex/codexText.ts` | `src/modules/harness/lib/harness/codexText.ts` | different |
| `src/integrations/harness/providers/cursor/cursor.ts` | `src/modules/harness/lib/harness/cursor.ts` | different |
| `src/integrations/harness/providers/grok/grokText.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/grok/grokText.ts` | `src/modules/harness/lib/harness/grokText.ts` | different |
| `src/integrations/harness/providers/hermes/hermes.ts` | `src/modules/harness/lib/harness/hermes.ts` | different |
| `src/integrations/harness/providers/opencode/opencode.ts` | `src/modules/harness/lib/harness/opencode.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeCatalog.ts` | `src/modules/harness/lib/harness/opencodeCatalog.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeClient.test.ts` | `src/modules/harness/lib/harness/opencodeClient.test.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeClient.ts` | `src/modules/harness/lib/harness/opencodeClient.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeLive.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/opencode/opencodeProtocol.test.ts` | `src/modules/harness/lib/harness/opencodeProtocol.test.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeProtocol.ts` | `src/modules/harness/lib/harness/opencodeProtocol.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeService.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/opencode/opencodeService.ts` | none | no_candidate |
| `src/integrations/harness/providers/opencode/opencodeText.test.ts` | `src/modules/harness/lib/harness/opencodeText.test.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeText.ts` | `src/modules/harness/lib/harness/opencodeText.ts` | different |
| `src/integrations/harness/providers/opencode/opencodeV2Events.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/opencode/opencodeV2Events.ts` | none | no_candidate |
| `src/integrations/harness/providers/pi/piCatalog.test.ts` | none | no_candidate |
| `src/integrations/harness/providers/pi/piCatalog.ts` | `src/modules/harness/lib/harness/piCatalog.ts` | different |
| `src/integrations/harness/providers/pi/piFamily.ts` | `src/modules/harness/lib/harness/piFamily.ts` | different |
| `src/integrations/harness/providers/pi/piLive.test.ts` | `src/modules/harness/lib/harness/piLive.test.ts` | different |
| `src/integrations/harness/providers/pi/piProtocol.test.ts` | `src/modules/harness/lib/harness/piProtocol.test.ts` | different |
| `src/integrations/harness/providers/pi/piProtocol.ts` | `src/modules/harness/lib/harness/piProtocol.ts` | different |
| `src/platform/tauri/fs.ts` | `src/modules/harness/lib/fs.ts` | different |
| `src/shared/hooks/useAnimatedReorder.test.ts` | none | no_candidate |
| `src/shared/hooks/useAnimatedReorder.ts` | none | no_candidate |
| `src/shared/hooks/useDragResize.ts` | `src/modules/harness/hooks/useDragResize.ts` | different |
| `src/shared/hooks/useLockOverscroll.ts` | `src/modules/harness/hooks/useLockOverscroll.ts` | different |
| `src/shared/ui/ColorPickerPopover.tsx` | `src/modules/harness/chrome/ColorPickerPopover.tsx` | different |
| `src/shared/ui/Modal.tsx` | `src/modules/harness/chrome/Modal.tsx` | different |
| `src/shared/ui/ParticleText.tsx` | `src/modules/harness/chrome/ParticleText.tsx` | identical |
| `src/shared/ui/Popover.tsx` | `src/modules/harness/chrome/Popover.tsx` | different |
| `src/shared/ui/PrivateEmail.test.ts` | `src/modules/harness/chrome/PrivateEmail.test.ts` | different |
| `src/shared/ui/TabLabel.tsx` | none | no_candidate |
| `src/shared/ui/icons.tsx` | `src/modules/harness/chrome/icons.tsx` | different |
| `src/styles/index.css` | none | no_candidate |
| `tests/browser/markdown-performance.html` | none | no_candidate |
| `tests/browser/markdown-performance.spec.ts` | none | no_candidate |
| `tests/browser/markdown-performance.tsx` | none | no_candidate |
| `tests/browser/transcript-scroll.spec.ts` | none | no_candidate |
| `tests/browser/transcript.html` | none | no_candidate |
| `tests/browser/transcript.tsx` | none | no_candidate |
| `vite.config.ts` | none | no_candidate |

## Isolated merge checks

These textual merge checks do not produce compilable code or establish functional parity.

| Upstream path | Local path | Raw conflicts | Conflicts after import and branding cleanup |
| --- | --- | ---: | ---: |
| `src/integrations/harness/providers/codex/codexQuestions.ts` | `src/modules/harness/lib/harness/codexQuestions.ts` | 0 | 0 |
| `src/integrations/harness/providers/codex/codex.ts` | `src/modules/harness/lib/harness/codex.ts` | 12 | 10 |
| `src/integrations/harness/core/child.ts` | `src/modules/harness/lib/harness/child.ts` | 3 | 3 |
