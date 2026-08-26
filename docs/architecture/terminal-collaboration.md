# Terminal collaboration

Status: MVP implementation functionally closed on 2026-08-23. Quick Tunnel remains experimental. Windows host and guest smoke is confirmed; macOS and Linux qualification remains release follow-up.

## Current implementation

- `voktty-collab-protocol` defines versioned control messages, bounded binary frames and participant limits.
- Rust generates 256-bit invitation keys, verifies HMAC join proofs, rejects nonce replay and keeps one controller invariant.
- After the authenticated join, every control and PTY payload uses directional AES-256-GCM keys derived from the invitation, session and client nonce. Strict envelope counters reject replay, reordering and cross-direction use.
- The WebSocket server binds only to `127.0.0.1`, validates the session path, rejects browser `Origin` headers, accepts only the active loopback port or a valid `*.trycloudflare.com` host, requires authentication as the first message and applies connection, queue and message limits.
- Join traffic is limited to 120 attempts per minute for each hosted session. Join fields are bounded and reject control characters before authentication.
- PTY output is sequenced and retained in a replay window of at most 64 frames or 512 KiB. Authorized guest input uses the existing PTY writer.
- Protocol v3 authenticates `resumeAfter` as part of the join proof. PTY output and host resize events share one contiguous sequence. After a transient disconnect, the guest reconnects with bounded exponential backoff and receives only the frames after its last applied sequence.
- Output sequences must be exactly contiguous. A saturated participant queue removes that slow connection so it can resume; frames are never silently skipped.
- Before the Quick Tunnel becomes public, the host inserts an ordered barrier into the same PTY channel used by xterm. Once xterm has parsed every preceding write, `SerializeAddon` captures the grid, cursor, styling and bounded scrollback. Rust stores that snapshot at the barrier sequence, discards older replay frames and sends new guests the snapshot followed only by newer output.
- Serialized snapshots are UTF-8 and limited to 512 KiB. The frontend reduces captured scrollback when necessary; the protocol keeps normal PTY frames at 64 KiB.
- The host monitors replay occupancy and captures a new ordered snapshot before the bounded window is evicted. A join is rejected as `replay_unavailable` rather than constructing state across an unproven gap.
- PTY exit, manual close, host stop and application exit revoke participants and stop the local server and Quick Tunnel process.
- The host interface starts from a terminal context menu, verifies `cloudflared`, presents URL and code separately, lists participants, grants or revokes control, disconnects or bans participants and stops the session. Control requests persist in the participant record until resolved, so the host polling path can surface them. While a share remains active, its terminal shows a persistent participant menu with names, pending requests and individual moderation actions. Participant presence continues refreshing after the setup dialog closes.
- The guest runtime validates invitation URLs, permits plaintext WebSocket only on loopback, connects to public hosts through WSS with Rustls, decrypts PTY/control channels, sends bounded input and keeps guest resize local. Host grid changes arrive in the ordered terminal stream. `Nueva` opens an ephemeral shared terminal tab with visible connection, reconnection and role controls. Guest connection IDs use a separate frontend namespace and never enter local PTY process or agent-state APIs.
- `cloudflared` remains external. Voktty verifies it, starts a Quick Tunnel with an isolated empty configuration and disables self-update for the child process.

Shared tabs and their credentials are intentionally excluded from space persistence. A two-client Windows smoke confirmed host output, guest observation and independent application instances. Remote file citations, control authorization and reconnect behavior are implemented and covered by protocol, server and frontend tests. Additional hands-on citation, control handoff, network loss, TUI, macOS and Linux cases belong to release qualification and do not keep the MVP implementation open.

## Context

Voktty needs temporary collaboration between two or more desktop clients without operating a Voktty relay service. The host must keep ownership of the shell process, terminal lifecycle and workspace. Guests need live terminal output, observer access by default, optional host-approved control and read-only file citations through the AI composer.

The feature is exposed to the public Internet through a temporary Cloudflare Quick Tunnel, so all inputs crossing the WebSocket boundary are untrusted.

## Decisions

### Host-authoritative session

The host Rust process owns the PTY and the collaboration session. Guests receive a snapshot followed by sequenced output frames. Only the host and the single active controller may send input.

Window size, font and scale remain local preferences. The host owns the logical PTY columns and rows. Snapshots carry that grid and later host resizes are sequenced with PTY output. The guest xterm keeps the host grid fixed, while a guest window resize changes presentation only and never emits a PTY resize. This preserves wrapping, cursor coordinates and TUI correctness.

### Local server and replaceable transport

Rust binds the collaboration server only to `127.0.0.1`. `cloudflared` publishes that loopback endpoint. Collaboration messages do not depend on Cloudflare-specific types, so a managed relay can replace the tunnel later without changing terminal or file contracts.

Quick Tunnels are an experimental MVP transport. They have an ephemeral public URL and no Voktty availability guarantee.

The upgrade policy currently allows the active loopback listener and Cloudflare Quick Tunnel hosts. A future managed relay must add its host policy while preserving the same protocol and authentication boundary.

### Versioned protocol crate

`voktty-collab-protocol` owns the wire types, size limits and binary terminal frames. JSON is used for low-frequency control messages. PTY input, output, snapshots, host resizes and exit events use binary frames with contiguous sequence numbers. The authenticated join includes the last output sequence already applied by the guest.

All guests start as observers. Role changes are server-authored, one controller is allowed and host decisions are immediately revocable.

Disconnecting removes only the current connection. Banning also records the normalized participant name for the lifetime of the hosted session and rejects later joins with that name. Stopping the share clears the temporary ban set. A future account-backed relay should replace this session-local identity rule with authenticated participant identities.

### External cloudflared requirement

Voktty does not bundle or install `cloudflared`. The host can verify a configured absolute path or a binary found through PATH and known user install locations. If it is absent, Voktty presents a command for the detected operating system and package manager. The user copies and runs that command manually, then asks Voktty to verify again.

Guests do not need `cloudflared` unless they later host their own session.

### Read-only remote citations

The host may explicitly enable file citations for one authorized workspace root. Guests can search paths and read bounded text content for `@` citations. The collaboration surface has no file write, rename, delete or editor-open operation.

Every path is canonicalized on the host. Traversal, symlink escape, secret paths, binary content, oversized files and excessive request rates are rejected. Closing the shared terminal revokes the file capability.

The implementation uses correlated `file_search`, `file_read`, `file_search_result`, `file_content` and `file_error` control messages inside the existing encrypted WebSocket. The host honors workspace ignore files, limits scans to 50,000 entries and 16 levels, returns at most 200 paths per protocol response, reads at most 512 KiB of UTF-8 text and accepts at most 60 file requests per minute for each connection. The composer requests 30 paths at a time.

Only local workspace roots already authorized by Voktty can be enabled for the MVP. The guest composer never receives an absolute host path. Before remote results are displayed, it explains that cited content may be sent to the AI provider selected on the guest device.

## User flow

1. The host opens the terminal context menu and chooses **Share**.
2. The host optionally enables remote file citations and verifies the displayed local workspace root.
3. Voktty creates the terminal invitation only after `cloudflared` and the initial terminal snapshot are ready.
4. The guest connects with the separate URL and invitation code.
5. In the shared terminal tab, the guest types `@` in the AI composer to search the approved host root and attach one text file.
6. The host can stop sharing or close the terminal at any time. This disconnects every guest and revokes terminal and file access together.

The UI must warn that cited content can be sent to the AI provider selected by the guest.

The invitation accepts new guests for 15 minutes. Guests already connected remain online after that deadline. The host UI marks the invitation as expired and disables copying its code. To admit another guest, the host stops sharing and creates a new invitation.

## Operational limits and privacy

| Boundary | Limit or behavior |
| --- | --- |
| Hosted participants | 8 total positions including the host |
| Concurrent unauthenticated connections | 16 |
| Join attempts | 120 per hosted session and minute |
| Invitation lifetime | 15 minutes for new joins |
| Heartbeat timeout | 45 seconds |
| Outbound participant queue | 128 messages; saturation disconnects the slow guest |
| PTY frame | 64 KiB |
| Snapshot and replay bytes | 512 KiB each |
| File citations | 60 requests per connection and minute; 512 KiB UTF-8 text maximum |

Voktty sends no collaboration telemetry to a Voktty service. Local logs contain generic connection categories and operating-system errors, never invitation codes, HMAC proofs or terminal payloads. The public Quick Tunnel URL is displayed only to the host and is not combined with the invitation code.

## Threat model and mitigations

| Threat | Mitigation |
| --- | --- |
| Internet scanning | High-entropy session code, 15-minute join expiry, 120 attempts per minute and 16 concurrent connections |
| Browser WebSocket abuse | Browser `Origin` rejection, exact session path and loopback or Quick Tunnel host allowlist |
| Replay | Nonces, protocol-bound authentication proof and monotonic frame sequences |
| Unauthorized input | Observer default, server-owned roles and one controller invariant |
| Filesystem escape | Host-side canonicalization, workspace authorization and secret-path policy |
| Resource exhaustion | Frame limits, participant cap, bounded queues, slow-consumer disconnect, bounded replay and timeouts |
| Secret leakage | Codes and proofs excluded from URLs, events and logs |
| Orphan session | Host terminal close, application exit and explicit stop close every peer and tunnel process |

Cloudflare TLS protects the outer network path. Voktty additionally encrypts all post-authentication application payloads end to end with per-connection directional keys, so the Quick Tunnel never receives terminal plaintext.

## Trade-offs

- A canonical host grid can require scaling or panning on a small guest window. This is accepted to keep interactive terminal semantics correct.
- Quick Tunnel avoids a Voktty service but depends on an external binary and third-party availability.
- Read-only citations provide useful project context without introducing collaborative editor or mutation complexity.
- A separate protocol crate adds one workspace member but keeps security limits testable without Tauri or network dependencies.

## Revisit triggers

- Persistent sessions or host failover require a managed relay.
- Multiple controllers require a different input arbitration model.
- Editor collaboration requires a document synchronization protocol and is outside this contract.
