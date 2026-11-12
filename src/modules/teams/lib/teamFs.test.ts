import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  readRole,
  readRoster,
  readTeamState,
  teamPath,
  writeTeamState,
} from "./teamFs";
import { TEAM_STATE_SCHEMA, type TeamState } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/harness/lib/fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { readTextFile, writeTextFile } from "@/modules/harness/lib/fs";

describe("teamFs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs team paths correctly with normalization", () => {
    expect(teamPath("/home/user/project", ".voktty", "team", "agents.json")).toBe(
      "/home/user/project/.voktty/team/agents.json",
    );
    expect(teamPath("C:\\Users\\dev\\project", ".voktty", "state", "agents.json")).toBe(
      "C:/Users/dev/project/.voktty/state/agents.json",
    );
  });

  it("reads and parses valid roster", async () => {
    const validRosterJson = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "developer",
          role: "roles/developer.md",
          start: "on-demand",
          runtime: {
            adapter: "claude-code",
            model: "claude-3-7-sonnet",
          },
          owns: ["src/"],
        },
      ],
    });

    vi.mocked(readTextFile).mockResolvedValueOnce(validRosterJson);

    const result = await readRoster("/repo");
    expect(result.roster).not.toBeNull();
    expect(result.roster?.agents[0].name).toBe("developer");
    expect(result.error).toBeUndefined();
  });

  it("returns diagnostic error on invalid roster", async () => {
    const invalidRosterJson = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "developer",
          role: "roles/developer.md",
          start: "on-demand",
          runtime: {
            adapter: "unknown-adapter",
          },
        },
      ],
    });

    vi.mocked(readTextFile).mockResolvedValueOnce(invalidRosterJson);

    const result = await readRoster("/repo");
    expect(result.roster).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toContain("agents.0.runtime.adapter");
  });

  it("treats a project without a roster as an empty team, locally and over SSH", async () => {
    vi.mocked(readTextFile).mockRejectedValueOnce(
      new Error("No such file or directory (os error 2)"),
    );
    expect(await readRoster("/repo")).toEqual({ roster: null });
    vi.mocked(readTextFile).mockRejectedValueOnce("not_found: not_found");
    expect(await readRoster("/repo")).toEqual({ roster: null });
  });

  it("still reports a roster that exists but cannot be read", async () => {
    vi.mocked(readTextFile).mockRejectedValueOnce(
      new Error("permission_denied: access denied"),
    );
    const result = await readRoster("/repo");
    expect(result.roster).toBeNull();
    expect(result.error).toContain("permission_denied");
  });

  it("does not mistake an agent lookup failure for a missing file", async () => {
    vi.mocked(readTextFile).mockRejectedValueOnce(new Error("agent_not_found"));
    expect((await readRoster("/repo")).error).toContain("agent_not_found");
  });

  it("reads role content", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("# Developer role\nDo work.");
    const content = await readRole("/repo", "roles/developer.md");
    expect(content).toBe("# Developer role\nDo work.");
    expect(readTextFile).toHaveBeenCalledWith("/repo/.voktty/team/roles/developer.md");
  });

  it("reads and writes team state with custom schema urn:voktty:team-state:1", async () => {
    const state: TeamState = {
      $schema: TEAM_STATE_SCHEMA,
      version: 1,
      updatedAt: "2026-11-10T20:00:00.000Z",
      agents: {
        developer: {
          sessionId: "s_123",
          status: "idle",
          task: "Fix tests",
          lastVerdict: {
            text: "All 12 tests passing",
            timestamp: "2026-11-10T20:05:00.000Z",
          },
          worktree: "/home/user/.local/share/voktty/worktrees/repo-dev",
          supervised: true,
        },
      },
    };

    vi.mocked(readTextFile).mockResolvedValueOnce(JSON.stringify(state));

    const loaded = await readTeamState("/repo");
    expect(loaded.$schema).toBe(TEAM_STATE_SCHEMA);
    expect(loaded.agents.developer.status).toBe("idle");
    expect(loaded.agents.developer.worktree).toBe("/home/user/.local/share/voktty/worktrees/repo-dev");

    // Test writing
    await writeTeamState("/repo", loaded);
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    const writtenJson = JSON.parse(vi.mocked(writeTextFile).mock.calls[0][1]);
    expect(writtenJson.$schema).toBe(TEAM_STATE_SCHEMA);
    expect(writtenJson.agents.developer.sessionId).toBe("s_123");
    expect(writtenJson.agents.developer.agentToken).toBeUndefined();
  });

  it("E2: manages generic command approvals via native Rust commands outside workspace", async () => {
    const {
      approveGenericCommand,
      isGenericCommandApproved,
      readGenericApprovals,
      revokeGenericCommand,
    } = await import("./teamFs");

    // 1. Check approval invokes team_is_generic_command_approved
    vi.mocked(invoke).mockResolvedValueOnce(false);
    let approved = await isGenericCommandApproved("/repo", "custom-bot", "python3 runner.py");
    expect(approved).toBe(false);
    expect(invoke).toHaveBeenCalledWith("team_is_generic_command_approved", {
      projectPath: "/repo",
      agentName: "custom-bot",
      command: "python3 runner.py",
    });

    // 2. Approve command invokes team_approve_generic_command (does NOT write to .voktty/state)
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await approveGenericCommand("/repo", "custom-bot", "python3 runner.py");
    expect(invoke).toHaveBeenCalledWith("team_approve_generic_command", {
      projectPath: "/repo",
      agentName: "custom-bot",
      command: "python3 runner.py",
    });
    expect(writeTextFile).not.toHaveBeenCalledWith(
      expect.stringContaining("generic_approvals.json"),
      expect.anything(),
    );

    // 3. Read generic approvals invokes team_read_generic_approvals
    vi.mocked(invoke).mockResolvedValueOnce({
      "custom-bot": {
        command: "python3 runner.py",
        approved_at: "2026-11-11T12:00:00Z",
      },
    });
    const approvals = await readGenericApprovals("/repo");
    expect(approvals["custom-bot"]).toEqual({
      command: "python3 runner.py",
      approvedAt: "2026-11-11T12:00:00Z",
    });

    // 4. Revoke command invokes team_revoke_generic_command
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await revokeGenericCommand("/repo", "custom-bot");
    expect(invoke).toHaveBeenCalledWith("team_revoke_generic_command", {
      projectPath: "/repo",
      agentName: "custom-bot",
    });
  });
});
