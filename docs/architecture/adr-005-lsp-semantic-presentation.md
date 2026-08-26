# ADR-005: Bounded LSP semantic presentation

## Status

Accepted on 2026-08-24.

## Context

Syntax grammars know lexical structure but cannot always distinguish a type, parameter, property or implementation chosen by the compiler. Language servers can provide semantic tokens and inlay hints, but their responses may be large, stale, malformed or visually incompatible with the selected CodeMirror theme.

Voktty must preserve the existing lazy LSP lifecycle, the 4 MiB editor threshold and the rule that a disabled feature performs no request. Background panes stay mounted, so an unbounded whole-workspace or whole-document hint strategy would accumulate avoidable memory and network work.

## Decision

Semantic presentation remains a frontend CodeMirror responsibility inside the lazy LSP chunk.

- Semantic highlighting advertises the standard relative token format and requests `textDocument/semanticTokens/full` only when the server declares a full provider and the user setting is enabled.
- Responses are decoded by a dependency-light normalizer, capped at 20,000 tokens and mapped from zero-based UTF-16 positions without accepting surrogate splits, invalid lines or overlaps.
- Semantic marks reuse the active CodeMirror `HighlightStyle` through Lezer tags. They have higher decoration precedence than lexical marks and are regenerated after a theme reconfiguration, so Voktty does not impose a second hardcoded palette.
- Inlay hints request only the visible viewport plus a 20-line margin. Responses are normalized as plain text, capped at 500 visible hints and rendered as non-editing widgets.
- Semantic requests wait for 300 ms of document inactivity. Inlay requests wait for 180 ms after document or viewport changes. Both bind the response to a generation and immutable document snapshot; late responses are discarded.
- The settings `editorSemanticHighlighting` and `editorInlayHints` are enabled by default and independently configurable. Disabling either removes its extension and therefore its requests and decorations.
- Definition, type-definition, implementation and reference results share one validated normalizer capped at 1,000 unique locations. Every jump routes through the existing workbench navigation history.
- Peek Definition and Peek References reuse the same request and location contract. Their lazy read-only CodeMirror surface caps references at 500, source files at 2 MiB, its cache at four files and the rendered excerpt at 256 KiB. Opening a selected result returns to the canonical navigator.

Semantic-token deltas are not requested in this phase. The full response is simpler to validate and the 4 MiB LSP threshold already bounds document size. Delta support can be reconsidered only if profiling demonstrates a material transfer or latency problem.

## Consequences

- Lexical highlighting remains available before the server responds and whenever semantic highlighting is disabled.
- Servers that do not declare a capability produce no related request or placeholder UI.
- Scrolling can request a new bounded hint window, but superseded responses cannot repaint the current viewport.
- Hint label commands, edits and server markup are intentionally not executed or rendered as HTML.
- Theme changes may trigger one new semantic-token request for each mounted LSP editor.
- Peek adds no request or preview editor until the user invokes its command. Edits close an open Peek so its source location cannot silently drift.

## Rejected alternatives

- Styling token types with fixed colors would conflict with user-selected editor themes.
- Requesting inlay hints for the entire document would waste work for hidden and off-screen code.
- Applying semantic-token deltas immediately would add result-id state and recovery paths before there is measured need.
- Inferring semantic categories with frontend regular expressions would duplicate compiler knowledge and diverge from the active language server.
