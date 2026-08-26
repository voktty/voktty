# ADR-008: Unified tool capability boundary and MCP client baseline

## Status

Accepted on 2026-08-25.

## Context

Voktty currently has two executable tool families. Built-in AI tools are assembled by `buildTools()` in `src/modules/ai/tools/tools.ts`, while extension tools are adapted in `src/modules/ai/tools/extensions.ts`. Both are exposed to the AI SDK from `src/modules/ai/lib/agent.ts`. Extension calls use AI SDK approval, bounded input and output, a timeout and a restricted name, but the approval pause runs in the webview and is not an authoritative security grant.

The existing native boundaries already provide useful primitives:

- `src-tauri/src/modules/net.rs` validates schemes, destinations, DNS results, redirects and response budgets for outbound HTTP.
- `src-tauri/src/modules/secrets.rs` stores credentials through the operating-system keyring on macOS and Windows and a mode-0600 fallback on Linux.
- PTY and LSP lifecycle code owns native child processes, process groups and Windows Job Objects.
- The two-process architecture assigns process, network, secret and security authority to Rust. React owns presentation and user coordination.

There is no MCP client, shared capability policy, consumable approval grant or canonical identity that spans built-ins, extensions and external tools. Adding MCP directly to the AI dispatcher would therefore create a second execution runtime and would let presentation-layer state become a security decision.

The MCP plan was originally written against revision `2025-11-25`. The current stable specification is `2026-07-28`, which defines a stateless modern era with materially different lifecycle and transport rules. The protocol baseline must be fixed before adding dependencies or transport code.

## Standards baseline

Voktty targets MCP `2026-07-28` as its native protocol revision. The implementation follows these normative sources:

- [MCP versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [MCP server discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [MCP stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [RFC 9110, HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9112, HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html)

The following changes from the old planning baseline are binding:

- Modern requests carry protocol version, capabilities and optional client identity in `_meta.io.modelcontextprotocol/*`. There is no `initialize` or `initialized` handshake.
- `server/discover` reports supported versions, capabilities and self-reported server identity. Identity metadata is display and diagnostic data, never a security principal.
- Modern core operation is stateless. Streamable HTTP has no protocol session and no general GET stream.
- Every HTTP JSON-RPC message uses a separate POST. A request returns either JSON or request-scoped SSE. Long-lived notifications use an explicit `subscriptions/listen` request.
- Servers do not initiate arbitrary JSON-RPC requests. Multi-round-trip input is represented in a result and the original request is retried with input responses.
- stdio uses one newline-delimited JSON-RPC message per line. Embedded newlines and non-protocol stdout are invalid.
- Tool schemas use JSON Schema 2020-12. External references are not automatically dereferenced. Schema validation remains resource bounded.
- HTTP mirrors selected body metadata into required headers. The JSON-RPC body remains the source of truth, and mirrored values must match it.
- `x-mcp-header` is accepted only for statically reachable primitive properties that satisfy the specification. An invalid definition excludes that tool from HTTP discovery.
- Roots, sampling and logging are deprecated core features. Tasks are an extension. None is required for the first MCP client release.

Voktty is a dual-era client only for revision `2025-11-25`. Compatibility is isolated behind a legacy adapter:

- stdio probes with modern `server/discover`. A recognized modern version error stays in the modern path. Any other error or bounded timeout may select the legacy initialization path.
- HTTP first attempts a modern request and inspects a 4xx JSON-RPC body. A recognized modern error stays modern; an unrecognized legacy response may select the legacy adapter.
- Era detection is cached only for the configured stdio process lifetime or HTTP origin and is invalidated when the assumption fails.
- The deprecated `2024-11-05` HTTP+SSE transport is not supported. It may be reconsidered only with demonstrated user need, a separate opt-in and its own threat review.

## Decision

### One authoritative capability core

A dependency-light Rust core owns the security vocabulary and pure policy decisions for every executable tool. It must not depend on Tauri, Tokio, HTTP, process management, storage or MCP transport code. Cortex, MCP and built-in execution consume this core; none reimplements it.

The serializable contract consists of these concepts:

| Contract | Required fields and invariant |
| --- | --- |
| `ToolOrigin` | `builtin`, `extension` or `mcp`; external metadata cannot change it |
| `ToolIdentity` | origin, trusted source id, remote or local name, and Voktty namespaced name; the tuple is stable and collision checked |
| `ToolEffect` | a set drawn from `read`, `write`, `process`, `network`, `secret`, `publish` and `delete`; unknown or ambiguous behavior is never classified as harmless |
| `CapabilityScope` | optional workspace, host, resource, session and agent identifiers; missing scope never means global scope |
| `ExecutionLimits` | timeout, input bytes, output bytes, concurrency and rate budgets bounded by Voktty maxima |
| `CapabilityDecision` | `allow`, `requireApproval` or `deny`, plus stable reason codes and effective limits |
| `ApprovalGrant` | opaque random id, identity digest, exact effects, exact scope, expiry and single-use state; only Rust can issue and consume it |

The DTOs crossing IPC contain displayable decisions and opaque grant ids. They never contain a user-controlled `trusted`, `approved` or `allow` boolean. A TypeScript mirror exists for exhaustive UI rendering, but Rust deserializes and validates the request again before execution.

`ToolIdentity.namespacedName` follows `origin.sourceId.toolName` with canonical escaping and length checks. Built-in names remain reserved. A collision, invalid segment or normalization mismatch rejects registration instead of silently renaming a tool.

### Conservative classification

Voktty computes effects from trusted built-in declarations and local administrator policy. External names, descriptions, annotations, schemas and server instructions are untrusted hints. They may increase required scrutiny but cannot remove an effect or grant automatic execution.

The initial policy is deny by default:

- An unknown tool identity is denied.
- An invalid, oversized or ambiguous schema is denied.
- A known bounded read may be allowed automatically within an exact workspace or resource scope.
- Write, process, network, secret, publish and delete effects require an exact one-use approval unless a later trusted policy explicitly denies them.
- Scope widening, additional effects or increased limits require a new decision and a new grant.
- A grant is consumed atomically before dispatch. Replay, expiry, identity mismatch and scope mismatch are denied.
- Approval in an AI SDK card is presentation of the request, not proof of authority. The native grant remains mandatory.

### Runtime ownership

`src-tauri/src/modules/mcp/` will own protocol negotiation, JSON-RPC correlation, stdio processes, Streamable HTTP, OAuth, cancellation, bounded queues and connection state. It invokes the capability core immediately before every call and records a redacted audit envelope.

`src/modules/mcp/` will own lazy settings and status presentation. `src/modules/ai/tools/` will adapt already validated descriptors to the AI SDK and route execution through native IPC. It will not spawn processes, fetch MCP endpoints, hold OAuth tokens or decide policy.

`buildTools()` remains the single per-run assembly point. It receives an immutable snapshot of validated, namespaced MCP descriptors. A discovery update applies only to later AI runs and cannot mutate a run in progress.

No server process, connection, discovery request, timer, OAuth request or MCP frontend chunk is created when no server is enabled.

### Lifecycle and status contracts

The native layer exposes bounded, serializable states rather than transport objects:

- Configuration: `disabled`, `enabled` or `revoked`.
- Lifecycle: `stopped`, `starting`, `discovering`, `ready`, `degraded`, `stopping` or `failed`.
- Authentication: `notRequired`, `required`, `authorizing`, `authorized`, `expired` or `failed`.
- Operation: `queued`, `awaitingApproval`, `running`, `inputRequired`, `succeeded`, `cancelled`, `timedOut` or `failed`.

Every state transition includes server id, monotonic operation id, timestamp and a stable reason code. User-visible detail is bounded and redacted. Raw tool arguments, tool output, authorization headers and tokens are never emitted in status events or logs.

Modern lifecycle is:

1. Load enabled non-secret configuration.
2. For stdio, spawn without a shell and probe with `server/discover`. For HTTP, issue a modern discovery or first operation request through the guarded network boundary.
3. Select a mutually supported revision. Enter the isolated `2025-11-25` adapter only after bounded era detection.
4. Discover paginated descriptors and reject invalid identities or schemas.
5. Classify descriptors through the capability core and publish an immutable registry snapshot.
6. For each call, validate input, obtain a policy decision, consume any required grant in Rust, invoke, validate output and emit redacted completion metadata.
7. On disable, revocation, fatal protocol error or application shutdown, cancel pending work and close the process or connection completely.

### Error taxonomy

Errors use stable categories with transport-specific details kept internal:

| Category | Examples | Default result |
| --- | --- | --- |
| `configuration` | missing executable, invalid endpoint, unauthorized cwd | failed, no start |
| `identity` | namespace collision, changed server id, malformed name | descriptor rejected |
| `policy` | unknown tool, denied effect, missing scope | call denied |
| `approval` | expired grant, replay, mismatch, already consumed | call denied |
| `schema` | invalid JSON Schema, external reference, depth or byte limit | descriptor or payload rejected |
| `protocol` | invalid JSON-RPC, duplicate id, wrong version, stdout garbage | operation failed, server may disconnect |
| `transport` | spawn failure, HTTP failure, truncated SSE, disconnect | bounded retry or failed |
| `authentication` | OAuth discovery, audience, PKCE or token failure | failed, credentials protected |
| `security` | SSRF, DNS change, redirect violation, header mismatch | hard failure, no fallback |
| `resourceLimit` | timeout, queue, rate, concurrency, frame or output limit | cancel and fail closed |
| `cancelled` | user, run or shutdown cancellation | cancel and clean up |

Security, policy and approval failures are never retried automatically. Transport retries, if later introduced, must be idempotence aware and remain within the original operation budget.

### Fixed implementation budgets

These maxima are part of the contract and may be lowered per server or tool. Raising them requires review and tests.

| Resource | Maximum |
| --- | ---: |
| Server id, tool name or namespace segment | 128 UTF-8 bytes |
| Tool description or server instructions | 4 KiB each |
| Discovered tools | 512 per server |
| Pagination requests | 100 per collection refresh |
| Input or output schema | 256 KiB each |
| Schema nesting depth | 32 |
| Schema nodes | 4,096 |
| Object properties across a schema | 1,024 |
| Tool call input | 64 KiB |
| Tool call output delivered to the model | 512 KiB |
| One stdio line, JSON response or SSE event | 1 MiB |
| Captured stderr ring | 256 KiB per process |
| Pending operations | 128 per server |
| Concurrent calls | 4 per server |
| Default call timeout | 30 seconds |
| Idle subscription interval without data | 60 seconds before health evaluation |
| Calls accepted by default | 60 per minute per server |
| HTTP redirects | 5 per operation |

Parsing and validation must stop when any byte, depth, node, property, page or time budget is exceeded. External `$ref` values are not fetched. Output retained for diagnostics is smaller than output accepted for execution and is redacted before persistence.

### Transport constraints

stdio servers run with executable and arguments separated, no shell, an authorized canonical cwd and a minimal explicit environment. Secrets are injected only when a server configuration explicitly requires them. Closing stdin starts graceful shutdown; bounded escalation terminates the process tree using POSIX process groups or Windows Job Objects. stderr is diagnostic only and never interpreted as protocol success or failure.

Streamable HTTP reuses the native SSRF and DNS-pinning boundary. Every redirect is revalidated. Metadata endpoints, loopback, link-local and private destinations remain blocked unless a narrowly scoped configuration explicitly permits the required private destination. Tokens are audience bound and stored only through `secrets_*`. HTTP headers derived from `x-mcp-header` are encoded and compared against the body according to the fixed specification.

The `2026-07-28` path does not implement GET streams, protocol sessions, resumable SSE through `Last-Event-ID` or independent server-to-client JSON-RPC requests. Those behaviors exist only where required inside the isolated `2025-11-25` adapter.

## Delivery sequence

The dependency order is fixed:

1. Implement and close this shared capability core and MCP client foundation.
2. Let Cortex consume the same identity, scope, decision, grant and audit contracts for durable agents.
3. Implement API client and protocol tooling on the same network and capability boundaries.
4. Expose a Voktty MCP server only after Cortex provides durable identity, scoped policy and audit ownership.

MCP does not introduce durable memory, goals, agents or a second tool runtime.

## Consequences

All executable tools gain one identity, policy and approval model. React can explain a decision without becoming the decision maker. MCP transports can evolve behind stable descriptors, and Cortex can later reuse capability contracts without depending on MCP.

Supporting one legacy revision adds a small, explicit compatibility surface. It is preferable to encoding legacy lifecycle into the modern runtime. Servers older than `2025-11-25`, including HTTP+SSE-only servers, fail with an actionable compatibility error.

Resource limits can reject unusually large but otherwise valid servers. Settings must expose the rejection reason, and limits may be revisited with measured evidence rather than silently bypassed.

## Rejected alternatives

- Executing MCP from React was rejected because the webview does not own process, network, secret or security authority.
- Treating AI SDK approval as a native grant was rejected because UI state is replayable and cannot prove exact scope or single consumption.
- Giving each tool source its own permission system was rejected because origin-specific policies drift and invite confused-deputy bugs.
- Trusting MCP annotations for automatic execution was rejected because server metadata is untrusted input.
- Implementing only `2025-11-25` was rejected because it would start new work on a superseded stateful lifecycle.
- Mixing legacy initialization and sessions into the modern state machine was rejected because modern MCP is stateless per request.
- Supporting `2024-11-05` HTTP+SSE by default was rejected because it expands transport and SSRF surface without demonstrated need.
- Fetching external schema references was rejected because discovery must not become an uncontrolled network traversal.
- Registering discovered tools globally and mutating active AI runs was rejected because a run needs an immutable, auditable tool set.
