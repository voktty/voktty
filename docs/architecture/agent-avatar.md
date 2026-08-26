# Agent avatar

Voktty's agent avatar is a local SVG renderer that communicates operational state, not inferred emotion. It is independent from the model provider, so the same surface works with cloud APIs, OpenAI-compatible endpoints and local models.

## Runtime contract

The pure mapper in `src/modules/ai/avatar/presence.ts` consumes the existing chat and terminal lifecycle contracts:

| Source signal | Avatar state |
| --- | --- |
| Chat idle | `idle` |
| Chat thinking with a planning step | `planning` |
| Chat thinking with a tool step | `tool-running` |
| Chat streaming | `streaming` |
| Pending approval | `awaiting-approval` |
| Chat error | `error` |
| CLI working | `tool-running` |
| CLI attention | `awaiting-approval` |
| CLI completed | `success` |
| CLI failed | `error` |

Chat signals come from `chatStore` and `AgentRunBridge`. CLI signals continue to come from the Rust PTY detector through `useTabProcessStatus`. The avatar does not access PTY, filesystem, network or secrets directly.

## Profiles and surfaces

`src/modules/ai/avatar/profiles.ts` contains original Voktty geometry and palettes for Coder, Architect, Code Reviewer, Security and Designer. Custom or unknown agents use the neutral Spark profile. The chat uses these Voktty profiles. CLI tabs use `AnimatedAgentIcon`: the existing branded `AgentIcon` remains visible and receives a small local face overlay, so Claude, Codex, Kimi, Antigravity and other detected tools remain identifiable. Disabling avatars removes only the face layer and keeps the original icon.

The renderer is used by the chat agent selector, the compact `AgentStatusPill` and terminal tabs with a detected coding agent. A tab without an identified agent keeps its previous icon. Changing the profile changes only the visual identity and does not change the active session or provider.

The SVG is inline and local. Breathing, blinking and activity use bounded CSS animations. The renderer has no network request, model call or third-party avatar asset.

## Settings and accessibility

The following preferences live in the existing settings store and are enabled by default:

- Agent avatars: enables or disables the visual renderer while retaining the previous fallback icon.
- Avatar size: compact, standard or large.
- Animation intensity: low, standard or high.
- Reduced motion: disables avatar animation independently of the operating-system preference.

All controls are translated in English and Spanish, keyboard reachable and disabled coherently when avatars are disabled. Standalone avatars expose an image role and label. Avatars used only as compact decoration are marked as hidden from assistive technology. `prefers-reduced-motion` also disables continuous animation without disabling state or profile colours.

## Semantic sounds

Avatar sounds use the existing `src/modules/sound` facade and the bundled local `uisfx` mechanical pack. No audio is downloaded and the feature degrades silently when the browser audio context is unavailable.

The avatar adds only a coalesced `progress-step` cue for meaningful transitions into `planning` or `tool-running`. Start, approval, error and completion cues remain owned by `LocalAgentNotificationsBridge`, so the same lifecycle does not produce duplicate audio. The cue is gated by the global sound switch, volume handling, hydration and the agent notification sound category. There is no sound per frame, render or streamed token.

## Performance evidence

The automated `src/modules/ai/avatar/performance.test.tsx` sample renders the same local SVG 120 times for the sidebar, mini chat and closed-state sizes. Its current Windows run observed:

| Surface | Average render | Heap delta | Markup |
| --- | ---: | ---: | ---: |
| Chat sidebar | 0.484 ms | 351.3 KiB | 1,117 bytes |
| Chat mini | 0.402 ms | 202.2 KiB | 1,117 bytes |
| Closed status | 0.383 ms | 12.9 KiB | 1,117 bytes |

The test keeps an average render below 5 ms, heap delta below 96 MiB and markup below 9,000 bytes. The heap value is a Node SSR observation, not a substitute for a browser process profile.

The production build emitted `AgentAvatar` at 9.33 kB raw and 3.65 kB gzip, plus 2.25 kB raw and 0.46 kB gzip CSS. The main startup JavaScript measured 361.4 kB gzip, below the configured 540 kB startup budget. The repository-wide `total client JS` size check remains above its configured limit in the current tree at 2.15 MB gzip versus 1.5 MB; this plan does not change that unrelated global budget.

## Verification

The avatar checkpoint was verified with:

- `pnpm check-types`
- `pnpm test` with 218 test files and 1,190 tests passing
- `pnpm lint` with no errors, while retaining the repository's existing warnings and infos
- `pnpm build`
- `pnpm exec vitest run src/modules/ai/avatar/performance.test.tsx --disableConsoleIntercept --reporter=verbose`

`pnpm size` reports the repository-wide total-client budget described above. It is recorded as a limitation and was not changed to hide the result.

## Manual smoke

The Windows smoke procedure is available but must be run in a packaged or development Voktty window:

1. Open the AI panel and switch between Coder, Architect, Code Reviewer, Security and Designer. Confirm that silhouette, eyes and palette identify the profile without changing the session.
2. Start a request with a configured cloud, OpenAI-compatible or local provider. Confirm the states for thinking or planning, tool execution, streaming and the short success pulse. Trigger an approval and confirm the approval state.
3. Enable interface sounds, interact once to unlock audio, then trigger planning and a tool transition. Confirm one coalesced progress cue and no cue for every streamed token.
4. Open a terminal tab and run a supported coding agent. Confirm that the tab avatar follows working, attention, completion and failure, and that a normal tab keeps its existing icon.
5. Change size and animation intensity, disable avatars, and enable the reduced-motion setting. Confirm that the fallback icon, keyboard access, state colour and chat functionality remain correct.

The smoke has not been executed by the automated environment. macOS and Linux visual qualification remain release checks.

## Boundaries

The MVP excludes external avatar packs, editor avatar authoring, Live2D, VRM, persistent floating avatars, lip synchronisation and text emotion analysis.
