// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { setRemoteCommandRunner } from "@/modules/harness/lib/fs";
import { prepareTeamProject } from "@/modules/teams/lib/teamProject";
import { remoteProjectFor } from "@/modules/connections/model/remoteProjects";
import { readRoster, readTeamState, writeTeamState } from "@/modules/teams/lib/teamFs";
import { readBus, resetRateLimits, sendMessage, writeBus } from "@/modules/teams/lib/teamBus";
import { writeRemoteMailboxMessage } from "@/modules/teams/lib/remoteMailbox";
import { openAgent } from "@/modules/teams/lib/agentLauncher";
import { clearLiveAgentRegistry, listLiveAgents } from "@/modules/teams/lib/agentRegistry";
import { usePreferencesStore } from "@/modules/settings/preferences";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(true) }));
const project = "remote://voktty-ssh-mini/srv/webserver";
const roster = { version: 1, agents: [{ name: "worker", role: "roles/worker.md", runtime: { adapter: "claude-code" } }] };
const files = new Map<string, string>();
const runner = vi.fn(async (command: string, args: Record<string, unknown>) => {
  if (command === "read_text_file") {
    const text = files.get(String(args.path));
    if (text === undefined) throw new Error("Missing file");
    return text;
  }
  if (command === "write_text_file") files.set(String(args.path), String(args.content));
  if (command === "create_path") return `${args.parent}/${args.name}`;
  return undefined;
});

describe("remote team project (E8.1)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    clearLiveAgentRegistry();
    resetRateLimits();
    localStorage.clear();
    files.clear();
    files.set(`${project}/.voktty/team/agents.json`, JSON.stringify(roster));
    files.set(`${project}/.voktty/team/roles/worker.md`, "# Worker role");
    setRemoteCommandRunner(runner);
    usePreferencesStore.setState({ sshConnections: [{ id: "mini", name: "Mini", host: "mini.example.test", port: 22 }] });
    await prepareTeamProject(project);
  });

  it("registers the exact saved SSH project for the helper router", () => {
    expect(remoteProjectFor(project)).toMatchObject({ environmentId: "voktty-ssh-mini", cwd: "/srv/webserver" });
  });

  it("routes roster, state, bus and inbox IO remotely without native filesystem calls", async () => {
    expect((await readRoster(project)).roster?.agents[0].name).toBe("worker");
    const state = await readTeamState(project);
    state.agents.worker = { status: "idle" };
    await writeTeamState(project, state);
    expect((await readTeamState(project)).agents.worker.status).toBe("idle");
    const bus = await readBus(project);
    await writeBus(project, bus);
    expect(await readBus(project)).toEqual(bus);
    const inboxPath = await writeRemoteMailboxMessage(project, "worker", { from: "owner", to: "worker", kind: "task", text: "Run tests" });
    expect(JSON.parse(files.get(inboxPath)!)).toMatchObject({ text: "Run tests" });
    expect(runner).toHaveBeenCalledWith("create_path", { parent: `${project}/.voktty`, name: "state", isDir: true });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps remote messages pending without a live session and deposits an inbox copy without an alias", async () => {
    files.set(`${project}/.voktty/team/agents.json`, JSON.stringify({ ...roster, agents: [
      ...roster.agents, { name: "orchestrator", role: "roles/orchestrator.md", runtime: { adapter: "claude-code" } },
    ] }));
    const message = await sendMessage({ projectPath: project, from: "orchestrator", to: "worker", kind: "task", text: "Run tests" });
    expect(message.delivered).toBe(false);
    expect((await readBus(project)).messages).toContainEqual(message);
    expect([...files.keys()].some((path) => path.startsWith(`${project}/.voktty/mailbox/worker/inbox/`))).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts an existing inbox directory but propagates inaccessible directory errors", async () => {
    const { ensureTeamDirectory } = await import("@/modules/teams/lib/teamFs");
    runner.mockRejectedValueOnce(new Error("Already exists"));
    await expect(ensureTeamDirectory(`${project}/.voktty/mailbox/worker/inbox`)).resolves.toBeUndefined();
    expect(runner).toHaveBeenLastCalledWith("list_dir", { path: `${project}/.voktty/mailbox/worker/inbox` });
    runner.mockRejectedValueOnce(new Error("Disconnected"));
    runner.mockRejectedValueOnce(new Error("Disconnected"));
    await expect(ensureTeamDirectory(`${project}/.voktty/state`)).rejects.toThrow("Disconnected");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a missing SSH profile without launching locally", async () => {
    usePreferencesStore.setState({ sshConnections: [] });
    const deps = { newSession: vi.fn(), cacheSession: vi.fn(), onNewHarnessTab: vi.fn() };
    const result = await openAgent({ projectPath: project, agentName: "worker" }, deps);
    expect(result.error).toBe("host_unconfigured");
    expect(deps.newSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["new", "resume"] as const)("opens %s on the project's SSH host without a roster alias or token in session/files", async (mode) => {
    if (mode === "resume") {
      const state = await readTeamState(project);
      state.agents.worker = { status: "idle", sessionId: "existing" };
      await writeTeamState(project, state);
    }
    const deps = {
      newSession: vi.fn((harness, cwd) => ({ id: "new-session", harness, cwd })),
      cacheSession: vi.fn(), onNewHarnessTab: vi.fn(() => 42),
    };
    const result = await openAgent({ projectPath: project, agentName: "worker", mode }, deps);
    expect(result.ok).toBe(true);
    expect(deps.onNewHarnessTab).toHaveBeenCalledWith(undefined, project, mode === "resume" ? "existing" : "new-session");
    const live = listLiveAgents(project)[0];
    expect(live).toMatchObject({ isRemote: true, remoteConnectionId: "mini" });
    expect(JSON.stringify([...files.values()])).not.toContain(live.agentToken);
    expect(JSON.stringify(deps.cacheSession.mock.calls)).not.toContain(live.agentToken);
    expect(invoke).toHaveBeenCalledWith("control_register_agent_token", { sessionId: result.sessionId, token: live.agentToken });
    expect(vi.mocked(invoke).mock.calls.every(([command]) => command === "control_register_agent_token")).toBe(true);
  });

  it.each([{ agentName: "worker", copy: 2 }, { agentName: "worker-2" }])("rejects remote worktree copies before creating resources: %o", async (params) => {
    const deps = { newSession: vi.fn(), cacheSession: vi.fn(), onNewHarnessTab: vi.fn(), ensureWorktree: vi.fn() };
    const result = await openAgent({ projectPath: project, ...params }, deps);
    expect(result.reason).toContain("copies with worktrees are not supported on remote SSH hosts");
    expect(result.ok).toBe(false);
    expect(deps.ensureWorktree).not.toHaveBeenCalled();
    expect(deps.newSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
