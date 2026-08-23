import { describe, expect, it } from "vitest";
import { historyWithLiveSessions } from "./sessionHistory";
import { newSession } from "./session";
import type { SessionSummary } from "./sessionStore";

function summary(
  id: string,
  cwd: string,
  updatedAt = 1,
): SessionSummary {
  return {
    id,
    cwd,
    harness: "cursor",
    model: "gpt-5",
    runtimeMode: "supervised",
    title: `cursor · ${id}`,
    createdAt: updatedAt,
    updatedAt,
    additions: 0,
    deletions: 0,
  };
}

describe("historyWithLiveSessions", () => {
  it("drops persisted sessions from other projects", () => {
    const history = [
      summary("a1", "/tmp/project-a"),
      summary("b1", "/tmp/project-b"),
    ];
    const rows = historyWithLiveSessions(history, [], "/tmp/project-a");
    expect(rows.map((row) => row.id)).toEqual(["a1"]);
  });

  it("does not inject live sessions from other projects", () => {
    const session = newSession("cursor", "/tmp/project-b");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions([], [session], "/tmp/project-a");
    expect(rows).toEqual([]);
  });

  it("includes live sessions for the active project", () => {
    const session = newSession("cursor", "/tmp/project-a");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions([], [session], "/tmp/project-a");
    expect(rows.map((row) => row.id)).toEqual([session.id]);
    expect(rows[0]?.repo).toBe("project-a");
  });

  it("stamps composer git onto a live session that is not persisted yet", () => {
    const session = newSession("cursor", "/tmp/monocode");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions([], [session], "/tmp/monocode", {
      repo: "monocode",
      branch: "main",
    });
    expect(rows[0]).toMatchObject({
      id: session.id,
      repo: "monocode",
      branch: "main",
    });
  });

  it("copies origin repo from sibling history and prefers the live branch", () => {
    const history = [
      {
        ...summary("a1", "/tmp/agent-terminal"),
        repo: "monocode",
        branch: "main",
      },
    ];
    const session = newSession("cursor", "/tmp/agent-terminal");
    session.blocks = [{ id: "u1", role: "user", text: "hello" }];
    session.busy = true;

    const rows = historyWithLiveSessions(
      history,
      [session],
      "/tmp/agent-terminal",
      { repo: "agent-terminal", branch: "fix-gutter" },
    );
    const live = rows.find((row) => row.id === session.id);
    expect(live).toMatchObject({
      repo: "monocode",
      branch: "fix-gutter",
    });
  });

  it("matches project paths with trailing slashes", () => {
    const history = [summary("a1", "/tmp/project-a/")];

    const rows = historyWithLiveSessions(history, [], "/tmp/project-a");
    expect(rows.map((row) => row.id)).toEqual(["a1"]);
  });
});
