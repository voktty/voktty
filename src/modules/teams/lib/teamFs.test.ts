import { describe, expect, it, vi, beforeEach } from "vitest";
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
});
