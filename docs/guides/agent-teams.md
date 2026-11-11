# Agent Teams in Voktty

Voktty provides a native multi-agent coordination subsystem that allows teams of specialized AI coding agents to collaborate within a project workspace. Agents run inside authentic interactive Harness sessions, communicate through an asynchronous message bus, respect role and permission boundaries, and can execute locally in isolated Git worktrees or remotely across SSH hosts.

## Core Concepts

An agent team consists of:
- **Roster (`.voktty/team/agents.json`)**: The declared team manifest defining agent names, roles, provider adapters, execution modes, model constraints, and host targets. Conforms to schema `urn:voktty:agent-roster:1`.
- **Roles (`.voktty/team/roles/*.md`)**: Markdown instructions injected into the agent session on launch, defining its domain of expertise, file ownership boundaries, and operational guidelines.
- **Rules (`.voktty/team/rules/*.md`)**: Global project rules shared across all team agents (such as testing standards, code style, and security invariants).
- **Team Board**: A visual management dashboard available per project (under the "Equipo" tab), displaying real-time agent status, active tasks, verdicts, and approval prompts.
- **Control Bridge**: An authenticated JSON-RPC control plane enabling orchestrator agents and the bundled CLI (`voktty agent *`) to inspect, start, message, and monitor subordinate agents.

## Team Configuration

The team roster resides at `.voktty/team/agents.json`.

```json
{
  "$schema": "urn:voktty:agent-roster:1",
  "version": 1,
  "defaults": {
    "runtime": {
      "adapter": "claude-code",
      "model": "claude-3-7-sonnet"
    },
    "host": "local"
  },
  "forbiddenModels": ["gpt-4-turbo-preview"],
  "agents": [
    {
      "name": "orchestrator",
      "role": "roles/lead.md",
      "start": "on-demand",
      "runtime": {
        "adapter": "claude-code",
        "model": "claude-3-7-sonnet"
      },
      "permissions": {
        "canOpenAgents": true,
        "mode": "automatic"
      }
    },
    {
      "name": "developer",
      "role": "roles/developer.md",
      "start": "on-demand",
      "runtime": {
        "adapter": "codex",
        "model": "o3-mini",
        "effort": "high"
      },
      "permissions": {
        "mode": "supervised"
      }
    },
    {
      "name": "gpu-worker",
      "role": "roles/gpu.md",
      "start": "on-demand",
      "host": "ssh:cluster-node",
      "runtime": {
        "adapter": "claude-code",
        "model": "claude-3-7-sonnet"
      }
    }
  ]
}
```

### Supported Provider Adapters

Voktty supports official provider adapters mapped to native interactive harnesses:
- `claude-code`: Anthropic Claude Code CLI.
- `codex`: OpenAI Codex / o-series CLI.
- `antigravity`: Google DeepMind Antigravity CLI.
- `opencode`: OpenCode CLI.
- `cursor`: Cursor agent integration.
- `grok`: xAI Grok coding assistant.
- `pi`: Pi developer agent.
- `hermes`: Hermes agent integration.

Adapters validate reasoning effort against provider capabilities (`low`, `medium`, `high`, `xhigh`, `max`), automatically degrading unsupported levels to available targets or rejecting unsupported effort where appropriate. The `generic` adapter is reserved for arbitrary external CLI programs and requires explicit native approval on each computer before execution.

### Supervised vs. Automatic Execution

- **Supervised (`supervised`)**: Tasks assigned by orchestrators place the subordinate agent into an `awaiting_owner` state with initial instructions pre-filled into the composer (`composerSeed`). The human owner reviews the task and confirms dispatch.
- **Automatic (`automatic`)**: The initial task is delivered directly as a live conversational turn into the agent's interactive PTY session.
- **Safety Rule**: If an agent is declared as `supervised` in the roster, an orchestrator starting it cannot relax this restriction to `automatic`. An orchestrator can only enforce stricter supervision, never bypass it.

## The Team Board

The Team Board provides a high-level operational overview of all configured agents.

Key capabilities:
- **Status Cards**: Displays real-time operational state:
  - `unopened`: Agent has not been launched yet.
  - `working`: In-flight conversation or task execution.
  - `idle`: Ready for instructions.
  - `waiting_approval`: Paused awaiting user permission for an interactive command or tool.
  - `awaiting_owner`: Supervised task queued awaiting human dispatch.
  - `quota_paused`: Paused by quota limiters.
  - `host_unconfigured`: Remote SSH host alias requires profile linkage.
  - `error`: Failed startup or communication error.
- **Lifecycle Buttons**:
  - `Start fresh`: Spawns a new interactive Harness tab with clean conversation state and injected role.
  - `Resume`: Reconnects to the active agent session without clobbering history.
  - `Go to tab`: Focuses the agent's visible interactive workspace tab.
  - `Stop`: Gracefully stops the agent session.
- **Editing Tools**: Add agents, edit existing definitions, and adjust global rules.

## CLI Control Plane (`voktty agent *`)

Orchestrator agents and terminal users can interact with team agents using the bundled `voktty` CLI:

### List Agents
```bash
voktty agent list
```
Outputs JSON array of registered agents with name, role, status, supervisor mode, and model.

### Start or Resume an Agent
```bash
# Start a fresh session with an initial task
voktty agent start developer --new --task "Implement user authentication endpoints"

# Resume an existing session
voktty agent start developer --resume

# Launch a parallel copy with its own Git worktree
voktty agent start developer --copy 2 --task "Write integration tests"
```

### Send a Message or Verdict
```bash
# Send a task
voktty agent message developer --text "Fix linting errors in auth.ts"

# Send a completion verdict
voktty agent message orchestrator --kind verdict --text "Auth endpoints implemented and verified"
```

### Wait for Results
```bash
# Wait until an agent produces a verdict
voktty agent wait developer --until verdict --timeout 300

# Query the final result
voktty agent result developer
```

### Close an Agent Session
```bash
voktty agent close developer
```

## Parallel Copies and Git Worktrees

When scaling work across multiple instances of an agent role (e.g. `developer-1`, `developer-2`), Voktty prevents workspace file conflicts by isolating each copy in a dedicated Git worktree:
- **Path Isolation**: Worktrees are located outside the main repository at `<parent>/<repo>-worktrees/<repo>-<agent>-<n>`.
- **Integrity Check**: Before opening or resuming an agent copy, Rust verifies that the target path is a registered, non-main Git worktree belonging to the project repository.
- **Clean Environment**: Copies operate with independent Git index and working trees while sharing underlying repository objects.

## Remote SSH Execution

Agents can be configured to run on remote servers using `host: "ssh:<alias>"`.

### Setup Steps
1. In the Team Board, an agent targeted to an unlinked SSH alias displays a `Host unconfigured` badge.
2. Click **Link SSH host**.
3. Select an existing SSH connection profile configured in Voktty.
4. Enter the **Remote project path** (e.g. `/srv/web-backend`). The root directory (`/`) is strictly prohibited for security.
5. Review the confirmation preview displaying the profile name and validated remote path.
6. Click **Save mapping**.

### Communication & Delivery Invariants
- **Turn-based delivery**: Messages to remote agents are delivered as interactive conversational turns into their active Harness PTY sessions (`proc.spawn`).
- **Offline queueing**: When an agent session is closed, pending messages are retained in the project bus (`delivered: false`) and automatically delivered as conversational turns when the session is reopened or resumed.
- **Mailbox format**: For environments running autonomous agents that poll the filesystem, Voktty deposits a message copy conforming to `templates/workspace-kit/dot-voktty/team/MESSAGING.md` at `.voktty/mailbox/<recipient>/inbox/<UTC>-<sender>-<suffix>.json`.
- **Verdict safety**: A disk mailbox file never alters an agent's status or `lastVerdict`. Verdicts enter exclusively via authenticated control plane RPC calls.

## Legacy Project Migration

Voktty includes a built-in Legacy Importer accessible from the Team Board:
- **Discovery**: Scans legacy projects (such as those using Python `arrancar.py`, `sesiones.json`, or shell harnesses) for existing agent configurations and prompt files.
- **Preview & Dry Run**: Displays a structural diff showing discovered agents, mapped roles, and cleaned parameters before making any changes.
- **Marker Sanitization**: Strips legacy session markers (such as Claude Code markers) while preserving session conversation files, allowing seamless resumption in modern Voktty Harness tabs.
- **Workspace Containment**: Writes strictly inside `.voktty/team/` and `.voktty/state/`. Path traversal attempts (`..`, absolute paths, Windows drives) are completely rejected.

## Security Architecture & Invariants

1. **Ephemeral Token Isolation**: Each launched agent session receives a cryptographically random `VOKTTY_AGENT_TOKEN`. The token is held in-memory and validated natively by the control bridge. Tokens are never written to disk, team state, log files, shell arguments, or remote SSH commands.
2. **Native State Separation**:
   - Host linkages (`app_data_dir/team_hosts.json`) and command approvals (`app_data_dir/team_generic_approvals.json`) reside in the desktop application data directory outside workspace and Git boundaries.
   - Forged files inside `.voktty/state/` or workspace roots concede zero authority.
3. **Atomic Operations & Process Mutex**:
   - All native store modifications utilize atomic file replacement (temporary file creation + sync + rename) wrapped in process-wide Mutex locks.
   - Corrupted JSON files immediately halt execution with an explicit error and are never overwritten in silence.
4. **Rate Limits & Hop Budgets**:
   - Inter-agent messaging is subject to per-minute rate limits (maximum 30 messages/min).
   - Messages decrement a hop budget (default 8) to terminate potential infinite autonomous reply loops.
5. **Turn-Based Authenticated Control**:
   - Verifying verdicts and updating agent operational state requires an authenticated control plane token. Filesystem inspection utilities are strictly diagnostic and read-only.
