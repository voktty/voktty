import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAgent,
  readRules,
  saveAgent,
  saveRules,
} from "./rosterEditor";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/harness/lib/fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { readTextFile, writeTextFile } from "@/modules/harness/lib/fs";

describe("rosterEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates developer agent with valid entry in team/agents.json and no machine fields", async () => {
    // Initial empty roster
    vi.mocked(readTextFile).mockRejectedValueOnce(new Error("File not found"));

    const result = await saveAgent("/project", {
      name: "developer",
      role: "roles/developer.md",
      start: "on-demand",
      runtime: {
        adapter: "claude-code",
        model: "claude-3-7-sonnet",
      },
      owns: ["src/"],
    });

    expect(result.ok).toBe(true);
    expect(result.roster?.agents[0].name).toBe("developer");

    // Check writeTextFile call
    expect(writeTextFile).toHaveBeenCalled();
    const calls = vi.mocked(writeTextFile).mock.calls;
    const rosterCall = calls.find((c) =>
      c[0].endsWith(".voktty/team/agents.json"),
    );
    expect(rosterCall).toBeDefined();
    const written = JSON.parse(rosterCall![1]);
    expect(written.version).toBe(1);
    expect(written.agents).toHaveLength(1);
    expect(written.agents[0].name).toBe("developer");
    expect(written.agents[0].role).toBe("roles/developer.md");
    // Ensure no machine-specific fields
    expect(written.agents[0].sessionId).toBeUndefined();
    expect(written.agents[0].token).toBeUndefined();
    expect(written.agents[0].agentToken).toBeUndefined();
    expect(written.agents[0].worktree).toBeUndefined();
  });

  it("rejects invalid agent with overlapping ownership naming the field", async () => {
    const existingRoster = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "lead",
          role: "roles/lead.md",
          runtime: { adapter: "claude" },
          owns: ["src/modules/"],
        },
      ],
    });

    vi.mocked(readTextFile).mockResolvedValueOnce(existingRoster);

    const result = await saveAgent("/project", {
      name: "junior",
      role: "roles/junior.md",
      start: "on-demand",
      runtime: { adapter: "claude" },
      owns: ["src/modules/teams/"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("agents.1.owns.0");
    expect(result.error).toContain("ownership overlaps");
  });

  it("rejects invalid agent with '..' in path naming the field", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce(
      JSON.stringify({ version: 1, agents: [] }),
    );

    const result = await saveAgent("/project", {
      name: "escapist",
      role: "roles/escapist.md",
      start: "on-demand",
      runtime: { adapter: "claude" },
      owns: ["../outside"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("agents.0.owns.0");
    expect(result.error).toContain("..");
  });

  it("rejects unknown adapter naming the field", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce(
      JSON.stringify({ version: 1, agents: [] }),
    );

    const result = await saveAgent("/project", {
      name: "bad-adapter",
      role: "roles/bad.md",
      start: "on-demand",
      runtime: { adapter: "magic-wand" as any },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("agents.0.runtime.adapter");
  });

  it("deletes an agent from roster", async () => {
    const existingRoster = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "agent1",
          role: "roles/1.md",
          runtime: { adapter: "claude" },
        },
        {
          name: "agent2",
          role: "roles/2.md",
          runtime: { adapter: "claude" },
        },
      ],
    });

    vi.mocked(readTextFile).mockResolvedValueOnce(existingRoster);

    const result = await deleteAgent("/project", "agent1");
    expect(result.ok).toBe(true);
    expect(result.roster?.agents).toHaveLength(1);
    expect(result.roster?.agents[0].name).toBe("agent2");
  });

  it("reads and saves project RULES.md", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce("# Custom Rules\nRule 1");
    const rules = await readRules("/project");
    expect(rules).toBe("# Custom Rules\nRule 1");

    await saveRules("/project", "# Updated Rules\nRule 1 and 2");
    expect(writeTextFile).toHaveBeenCalledWith(
      "/project/.voktty/RULES.md",
      "# Updated Rules\nRule 1 and 2",
    );
  });
});
