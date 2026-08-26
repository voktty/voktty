# Connect MCP servers

Voktty can connect the built-in AI agent to local MCP programs over stdio or remote servers over Streamable HTTP.

## Add a server

Open Settings and select MCP, then choose Add server.

For a local server, select stdio and provide the executable, its arguments, a working directory and an authorized root. Voktty launches the executable directly without a shell. The working directory must remain inside the authorized root.

For a remote server, select HTTP and enter an HTTPS endpoint. Private or loopback destinations require the visible private-network option. Choose no authentication, bearer or OAuth as required by the server. Credentials are stored by the native secret backend and are not written into the normal settings store.

Saving a server does not silently enable it. Enable it, then select Connect. OAuth servers expose an Authorize action and return to Voktty through a temporary loopback callback.

## Understand permissions

Every server and tool has a Voktty-owned namespace and scope. Server claims such as read-only or non-destructive are hints, not authority.

By default, tool calls require an approval card. A tool can run without approval only when you explicitly enable Allow without approval for that exact tool and its native classification remains exactly read-only. Any write, process, network, secret, publish or delete effect still requires approval.

Approval applies once to the exact call shown. It is not a permanent permission and cannot be reused with different arguments. Denying the card prevents the call from reaching the server.

MCP descriptions and results may contain misleading instructions. Voktty labels them as untrusted data and keeps execution behind native policy, but you should still connect only servers you understand.

## Lifecycle actions

- Disconnect stops the current client and cancels its active work.
- Restart discards discovered state and negotiates again.
- Revoke removes stored bearer or OAuth credentials and invalidates active snapshots.
- Disable stops the client while keeping its configuration.
- Delete asks for confirmation, stops the client and removes its configuration.

Changing configuration or per-tool automatic-read permission reconnects the server so a stale AI run cannot inherit the new policy. An AI run already waiting on approval keeps its immutable snapshot unless that server was disabled, changed or revoked.

## Troubleshooting

- Configuration errors usually indicate an invalid id, path, endpoint, argument or OAuth setting.
- Protocol errors mean the server produced invalid or unsupported MCP traffic.
- Security errors indicate a blocked destination, redirect, DNS result or metadata endpoint.
- Resource-limit errors indicate a timeout, oversized message, schema, result, queue or request rate.
- Incompatible-version errors mean the server supports neither `2026-07-28` nor the isolated `2025-11-25` adapter.

Voktty does not support the older HTTP+SSE `2024-11-05` transport. Raw server responses and authorization challenges are intentionally hidden from UI errors to avoid leaking secrets or hostile content.
