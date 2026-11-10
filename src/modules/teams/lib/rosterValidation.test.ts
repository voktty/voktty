import { describe, expect, it } from "vitest";
import { validateRoster } from "./rosterValidation";

describe("rosterValidation", () => {
  it("validates a well-formed roster", () => {
    const raw = JSON.stringify({
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
          owns: ["src/modules/teams/"],
          reads: ["docs/"],
        },
      ],
    });

    const res = validateRoster(raw);
    expect(res.roster).not.toBeNull();
    expect(res.error).toBeUndefined();
    expect(res.roster?.agents[0].name).toBe("developer");
  });

  it("rejects duplicate agent names", () => {
    const raw = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "developer",
          role: "roles/developer.md",
          runtime: { adapter: "claude" },
        },
        {
          name: "developer",
          role: "roles/verifier.md",
          runtime: { adapter: "claude" },
        },
      ],
    });

    const res = validateRoster(raw);
    expect(res.roster).toBeNull();
    expect(res.error).toContain("agents.1.name");
  });

  it("rejects unknown runtime adapter", () => {
    const raw = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "developer",
          role: "roles/developer.md",
          runtime: { adapter: "unsupported-adapter" },
        },
      ],
    });

    const res = validateRoster(raw);
    expect(res.roster).toBeNull();
    expect(res.error).toContain("agents.0.runtime.adapter");
  });

  it("rejects path with '..' in owns", () => {
    const raw = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "developer",
          role: "roles/developer.md",
          runtime: { adapter: "claude" },
          owns: ["src/../secret"],
        },
      ],
    });

    const res = validateRoster(raw);
    expect(res.roster).toBeNull();
    expect(res.error).toContain("agents.0.owns.0");
  });

  it("rejects overlapping ownership between different agents", () => {
    const raw = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "agentA",
          role: "roles/a.md",
          runtime: { adapter: "claude" },
          owns: ["src/modules/"],
        },
        {
          name: "agentB",
          role: "roles/b.md",
          runtime: { adapter: "claude" },
          owns: ["src/modules/teams/"],
        },
      ],
    });

    const res = validateRoster(raw);
    expect(res.roster).toBeNull();
    expect(res.error).toContain("agents.1.owns.0");
    expect(res.error).toContain("ownership overlaps");
  });

  it("requires command for generic adapter", () => {
    const raw = JSON.stringify({
      version: 1,
      agents: [
        {
          name: "bot",
          role: "roles/bot.md",
          runtime: { adapter: "generic" },
        },
      ],
    });

    const res = validateRoster(raw);
    expect(res.roster).toBeNull();
    expect(res.error).toContain("agents.0.runtime.command");
  });
});
