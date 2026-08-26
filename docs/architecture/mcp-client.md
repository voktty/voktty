# MCP client architecture

This guide elaborates on `VOKTTY.md` and ADR-008. If they conflict, `VOKTTY.md` wins.

## Scope and ownership

Voktty is an MCP client for local stdio servers and remote Streamable HTTP servers. The native revision is `2026-07-28`; the isolated compatibility adapter supports `2025-11-25`. HTTP+SSE `2024-11-05`, durable agent memory and a Voktty-hosted MCP server are outside this foundation.

Rust owns server lifecycle, JSON-RPC, process trees, network validation, OAuth, keychain access, schema validation, capability decisions, one-use approval grants, cancellation and audit. React owns lazy settings, status presentation and AI SDK adaptation. A webview decision alone never authorizes execution.

No enabled server means no MCP process, connection, timer, discovery, OAuth flow or eager frontend module. Opening Settings loads the MCP management chunk. Starting an AI run obtains an immutable snapshot of tools already connected by the user.

## Execution sequence

1. The user explicitly enables and connects a server.
2. Native negotiates the protocol and discovers bounded, namespaced descriptors.
3. Each AI run receives an immutable snapshot. Later discovery changes do not mutate that run.
4. Native validates input and decides policy immediately before dispatch.
5. An exact trusted read may run automatically. Every other effect waits for a one-use native grant.
6. The selected transport executes with cancellation, timeout, rate, concurrency and byte limits.
7. Native validates structured output before returning it.
8. The frontend labels remote descriptions and results as untrusted model data.
9. Audit stores only id, origin, tool, decision, duration and result.

## Threat model

Protected assets are workspace data, shell authority, network reachability, OAuth and bearer credentials, agent context and application availability. Attackers include a malicious local MCP executable, a compromised remote server, a hostile redirect or DNS answer, and prompt injection embedded in server metadata or tool output.

| Threat | Boundary and evidence |
| --- | --- |
| Command injection or orphaned child | argv is passed without a shell, cwd is authorized, environment is minimal, and process groups or Windows Job Objects terminate descendants. |
| JSON-RPC confusion | framing rejects garbage, oversized lines, invalid ids, duplicate or unexpected replies and unsupported server requests. |
| Schema or payload exhaustion | schema bytes, depth, nodes and properties are bounded; external references are rejected; input and output are validated twice where relevant. |
| Permission escalation | metadata can only increase scrutiny; automatic mode requires an exact user-trusted read; grants bind snapshot, tool, request and input and are single use. |
| Prompt injection | descriptions and results are marked untrusted; model text cannot issue a native grant, widen scope or alter effects. |
| SSRF and credential forwarding | each URL and redirect is classified and DNS pinned; metadata targets and origin changes are blocked; tokens remain audience bound. |
| OAuth interception or replay | PKCE S256, random state, literal loopback redirect, bounded callback parsing and keychain storage are mandatory. |
| Cancellation race or resource leak | pre-start cancellation is remembered once; active calls receive a transport token; lifecycle changes invalidate snapshots and stop clients. |
| Sensitive logging | status and audit omit arguments, content, schemas, URIs, challenges and tokens; remote errors are replaced with bounded categories. |

The adversarial Rust and TypeScript suites cover fragmented framing, response reordering, duplicate ids, stdout garbage, timeout, cancellation, descendant cleanup, external schemas, hostile redirects, token forwarding, legacy session hijack, OAuth state and audience binding, permission replay, input substitution, invalid output and prompt-injection labeling.

## Performance baseline

Measurements below were captured on 2026-08-25 on Windows 11 x86_64. They are observations from one development build and one run, not release thresholds. The fixture is `scripts/fixtures/mcp-stdio-server.mjs` executed through the real Rust stdio client.

| Metric | Observed |
| --- | ---: |
| Disabled manager construction | 15 us |
| First stdio connection and protocol negotiation | 65,245 us |
| First paginated tool discovery | 626 us |
| First tool call | 137 us |
| Idle fixture server working set | 36,831,232 bytes |
| Lazy MCP Settings chunk | 24.81 kB raw, 7.94 kB gzip |
| Main eager startup JavaScript | 358.28 kB gzip, budget 540 kB |

`pnpm analyze:eager` observed 431 local modules for the main window and 64 for Settings. The MCP module was absent from both eager graphs, enforced by `src/app/eager-budget.test.ts`. The repository-wide total client JavaScript check remains above its existing budget at 2.19 MB gzip versus 1.5 MB; the MCP chunk is lazy and does not alter the startup budget.

Reproduce the Windows transport measurements with:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib windows_mcp_performance_baseline -- --ignored --nocapture --test-threads=1
```

## Platform evidence

| Platform | Evidence in this milestone |
| --- | --- |
| Windows 11 x86_64 | Full TypeScript and Rust suites, production web build, stdio process-tree fixture and manual performance baseline executed. |
| Linux x86_64, Ubuntu on WSL2 | The portable capability core executed 18 tests successfully. The full MCP runtime smoke was attempted but could not compile because this distro lacks Node, `pkg-config` and GTK development libraries; no transport runtime success is claimed. |
| macOS | No hardware or runner was available, so no MCP smoke is claimed. |

## Maintenance rules

- Keep modern and legacy protocol state machines separate.
- Do not fetch external schema references.
- Do not add a frontend process, network or credential path.
- Do not expose raw remote errors, arguments or output in diagnostics.
- Raising any fixed budget requires measurements and adversarial tests.
- A Voktty MCP server remains blocked until Cortex owns durable identity, scope and audit.
