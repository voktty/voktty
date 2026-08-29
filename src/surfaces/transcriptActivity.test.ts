import { describe, expect, it } from "vitest";
import type { Block } from "../lib/session";
import {
  activityGroupView,
  activityPreviousCount,
  activityPreviousLabel,
  activitySummary,
  editVerb,
  groupTurnItems,
  groupTurns,
  lastActivityIndex,
  nextTickerIndex,
  proseSummary,
  splitActivityRows,
  toolCallLabel,
  turnCopyText,
} from "./transcriptActivity";

function shell(
  id: string,
  status = "completed",
  approval?: Block["approval"],
): Block {
  return {
    id,
    role: "tool",
    text: "bash ls",
    tool: { kind: "shell", title: "bash ls", status },
    ...(approval ? { approval } : {}),
  };
}

function edit(id: string): Block {
  return {
    id,
    role: "tool",
    text: "Edited src/App.tsx",
    tool: {
      kind: "edit",
      title: "Edited src/App.tsx",
      status: "completed",
      preview: { kind: "write", path: "src/App.tsx", fileName: "App.tsx" },
    },
  };
}

describe("groupTurnItems", () => {
  it("keeps consecutive shell calls in one activity stack", () => {
    const items = groupTurnItems([
      shell("a"),
      shell("b"),
      shell("c", "pending"),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "activity",
      blocks: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
  });

  it("does not split a stack when tools are waiting for approval", () => {
    const items = groupTurnItems([
      shell("a"),
      shell("b", "pending", { requestId: 1 }),
      shell("c", "pending", { requestId: 2 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("activity");
    if (items[0]?.type !== "activity") return;
    expect(items[0].blocks.map((block) => block.id)).toEqual(["a", "b", "c"]);
  });

  it("still splits around assistant text and file edits", () => {
    const items = groupTurnItems([
      shell("a"),
      { id: "msg", role: "assistant", text: "next I will edit" },
      edit("e"),
      shell("b", "pending", { requestId: 1 }),
    ]);
    expect(items.map((item) => item.type)).toEqual([
      "activity",
      "block",
      "block",
      "activity",
    ]);
  });

  it("does not split a stack across empty assistant placeholders", () => {
    const items = groupTurnItems([
      shell("a"),
      { id: "ghost", role: "assistant", text: "", streaming: true },
      shell("b", "pending", { requestId: 1 }),
      shell("c", "pending", { requestId: 2 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("activity");
    if (items[0]?.type !== "activity") return;
    expect(items[0].blocks.map((block) => block.id)).toEqual(["a", "b", "c"]);
  });
});

describe("splitActivityRows", () => {
  it("keeps the latest completed tool as the headline and inserts approvals above the collapsed rest", () => {
    const rows = splitActivityRows([
      shell("a"),
      shell("find"),
      shell("read", "pending", { requestId: 1 }),
      shell("run", "pending", { requestId: 2 }),
    ]);
    expect(rows.latest?.id).toBe("find");
    expect(rows.pending.map((block) => block.id)).toEqual(["read", "run"]);
    expect(rows.hidden.map((block) => block.id)).toEqual(["a"]);
  });

  it("shows only pending rows when nothing in the stack has finished", () => {
    const rows = splitActivityRows([
      shell("read", "pending", { requestId: 1 }),
      shell("run", "pending", { requestId: 2 }),
    ]);
    expect(rows.latest).toBeUndefined();
    expect(rows.pending.map((block) => block.id)).toEqual(["read", "run"]);
    expect(rows.hidden).toEqual([]);
  });
});

describe("ticker", () => {
  it("holds the row the ticker is on and counts the rest as passed", () => {
    const rows = splitActivityRows([shell("a"), shell("b"), shell("c")], 1);
    expect(rows.latest?.id).toBe("b");
    expect(rows.hidden.map((block) => block.id)).toEqual(["a"]);
    expect(rows.completed).toHaveLength(3);
  });

  it("clamps an index the stack has outgrown", () => {
    const rows = splitActivityRows([shell("a")], 4);
    expect(rows.latest?.id).toBe("a");
    expect(rows.hidden).toEqual([]);
  });

  it("steps forward one row at a time", () => {
    expect(nextTickerIndex(0, 3)).toBe(1);
    expect(nextTickerIndex(2, 3)).toBe(2);
  });

  it("skips to the live row when it falls too far behind", () => {
    expect(nextTickerIndex(0, 9)).toBe(8);
  });

  it("snaps back when the stack shrinks under it", () => {
    expect(nextTickerIndex(6, 2)).toBe(1);
    expect(nextTickerIndex(3, 0)).toBe(0);
  });
});

describe("turnCopyText", () => {
  it("joins assistant and plan markdown from the turn", () => {
    expect(
      turnCopyText([
        { id: "u", role: "user", text: "fix it" },
        { id: "a1", role: "assistant", text: "I'll inspect the file." },
        shell("t"),
        { id: "r", role: "reasoning", text: "thinking" },
        { id: "p", role: "plan", text: "## Plan\n\n- edit App.tsx" },
        { id: "a2", role: "assistant", text: "Done.\n\n```ts\nfixed\n```" },
        { id: "s", role: "system", text: "session error" },
      ]),
    ).toBe(
      "I'll inspect the file.\n\n## Plan\n\n- edit App.tsx\n\nDone.\n\n```ts\nfixed\n```",
    );
  });

  it("returns empty when the turn has no readable output", () => {
    expect(
      turnCopyText([
        { id: "u", role: "user", text: "go" },
        shell("t"),
        { id: "a", role: "assistant", text: "  " },
      ]),
    ).toBe("");
  });
});

describe("groupTurns", () => {
  it("keeps a handoff divider on its own row between providers", () => {
    const turns = groupTurns([
      { id: "u1", role: "user", text: "go" },
      { id: "a1", role: "assistant", text: "working" },
      {
        id: "h1",
        role: "handoff",
        text: "Goal: go",
        handoff: { from: "cursor", to: "claude", status: "ready" },
      },
      { id: "u2", role: "user", text: "continue" },
    ]);
    expect(turns.map((turn) => turn.map((block) => block.id))).toEqual([
      ["u1", "a1"],
      ["h1"],
      ["u2"],
    ]);
  });
});

describe("zen mode grouping", () => {
  it("folds edits into the activity stack", () => {
    const items = groupTurnItems([shell("a"), edit("b"), shell("c")], true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "activity",
      blocks: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
  });

  it("leaves edits as their own blocks when zen is off", () => {
    const items = groupTurnItems([shell("a"), edit("b"), shell("c")]);
    expect(items.map((item) => item.type)).toEqual([
      "activity",
      "block",
      "activity",
    ]);
  });

  it("keeps an edit awaiting approval out of the stack", () => {
    const pending = edit("b");
    pending.approval = { requestId: 1 };
    const items = groupTurnItems([shell("a"), pending], true);
    expect(items.map((item) => item.type)).toEqual(["activity", "block"]);
  });

  it("folds prose between tool calls in and leaves the final answer out", () => {
    const items = groupTurnItems(
      [
        { id: "u", role: "user", text: "cut the release" },
        { id: "a1", role: "assistant", text: "Running the checks first." },
        shell("a"),
        { id: "a2", role: "assistant", text: "Checks pass. Bumping:" },
        edit("b"),
        { id: "a3", role: "assistant", text: "Released." },
      ],
      true,
    );
    expect(items.map((item) => item.type)).toEqual([
      "block",
      "activity",
      "block",
    ]);
    if (items[1]?.type !== "activity") return;
    expect(items[1].blocks.map((block) => block.id)).toEqual([
      "a1",
      "a",
      "a2",
      "b",
    ]);
    expect(items[2]).toMatchObject({ type: "block", block: { id: "a3" } });
  });

  it("keeps the trailing run of prose blocks out of the stack", () => {
    const items = groupTurnItems(
      [
        shell("a"),
        { id: "a1", role: "assistant", text: "Half" },
        { id: "a2", role: "assistant", text: "Done", streaming: true },
      ],
      true,
    );
    expect(items.map((item) => item.type)).toEqual([
      "activity",
      "block",
      "block",
    ]);
  });

  it("folds every paragraph when the turn ends on a tool call", () => {
    const items = groupTurnItems(
      [{ id: "a1", role: "assistant", text: "Looking now." }, shell("a")],
      true,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "activity" });
  });

  it("leaves prose alone when zen is off", () => {
    const items = groupTurnItems([
      { id: "a1", role: "assistant", text: "Looking now." },
      shell("a"),
    ]);
    expect(items.map((item) => item.type)).toEqual(["block", "activity"]);
  });

  it("keeps thinking in the stack so a long think is visible", () => {
    const items = groupTurnItems(
      [
        { id: "r", role: "reasoning", text: "**Checking the config**" },
        shell("a"),
        { id: "done", role: "assistant", text: "Done." },
      ],
      true,
    );
    expect(items.map((item) => item.type)).toEqual(["activity", "block"]);
    if (items[0]?.type !== "activity") return;
    expect(items[0].blocks.map((block) => block.id)).toEqual(["r", "a"]);
  });

  it("drops thinking entirely when zen is off", () => {
    const items = groupTurnItems([
      { id: "r", role: "reasoning", text: "thinking" },
      shell("a"),
    ]);
    expect(items).toHaveLength(1);
    if (items[0]?.type !== "activity") return;
    expect(items[0].blocks.map((block) => block.id)).toEqual(["a"]);
  });

  it("does not count thinking as a tool call", () => {
    expect(
      activitySummary([
        { id: "r", role: "reasoning", text: "thinking" },
        shell("a"),
      ]),
    ).toBe("1 tool call");
  });

  it("summarises calls and distinct edited files", () => {
    expect(activitySummary([shell("a"), edit("b"), edit("c")])).toBe(
      "3 tool calls · 1 file edited",
    );
    expect(activitySummary([shell("a")])).toBe("1 tool call");
  });

  it("counts only tool calls, and falls back to messages without them", () => {
    const note: Block = { id: "a1", role: "assistant", text: "Looking now." };
    expect(activitySummary([note, shell("a"), edit("b")])).toBe(
      "2 tool calls · 1 file edited",
    );
    expect(activitySummary([note])).toBe("1 earlier message");
    expect(
      activitySummary([{ id: "r", role: "reasoning", text: "thinking" }]),
    ).toBe("1 thought");
  });

  it("folds to the summary even if live previous-tools were expanded", () => {
    expect(activityGroupView(true, 0, false)).toBe("summary");
    expect(activityGroupView(true, 0, true)).toBe("zen-expanded");
    expect(activityGroupView(false, 0, false)).toBe("live");
    expect(activityGroupView(true, 2, false)).toBe("live");
  });
});

describe("activityPreviousCount", () => {
  it("keeps zen's disclosure on from the first live step", () => {
    expect(activityPreviousCount(0, true, true)).toBe(1);
    expect(activityPreviousCount(0, true, false)).toBe(0);
    expect(activityPreviousCount(0, false, true)).toBe(0);
    expect(activityPreviousCount(3, true, true)).toBe(3);
  });

  it("labels the disclosure as steps in zen and tool calls otherwise", () => {
    expect(activityPreviousLabel(1, true)).toBe("+1 previous step");
    expect(activityPreviousLabel(2, true)).toBe("+2 previous steps");
    expect(activityPreviousLabel(1, false)).toBe("+1 previous tool call");
    expect(activityPreviousLabel(4, false)).toBe("+4 previous tool calls");
  });
});

describe("lastActivityIndex", () => {
  it("points at the fold that sits under the final answer", () => {
    const items = groupTurnItems(
      [
        { id: "u", role: "user", text: "go" },
        shell("a"),
        { id: "p", role: "plan", text: "## Plan" },
        shell("b"),
        { id: "done", role: "assistant", text: "Done." },
      ],
      true,
    );
    expect(lastActivityIndex(items)).toBe(3);
  });

  it("returns -1 for a turn that ran no tools", () => {
    expect(
      lastActivityIndex(
        groupTurnItems([{ id: "a", role: "assistant", text: "Hi." }], true),
      ),
    ).toBe(-1);
  });
});

describe("toolCallLabel", () => {
  it("shows the shell command, not the tool name", () => {
    expect(
      toolCallLabel({
        id: "a",
        role: "tool",
        text: "git status -s",
        tool: { kind: "execute", title: "git status -s" },
      }),
    ).toBe("git status -s");
    expect(
      toolCallLabel({
        id: "b",
        role: "tool",
        text: "Skill /code-review",
        tool: { kind: "skill", title: "Skill /code-review" },
      }),
    ).toBe("Skill /code-review");
  });
});

describe("editVerb", () => {
  it("canonicalises past-tense harness phrasing", () => {
    expect(editVerb("Edited src/App.tsx")).toBe("Edit");
    expect(editVerb("Deleted src/old.ts")).toBe("Delete");
    expect(editVerb("Renamed src/a.ts")).toBe("Move");
    expect(editVerb("Created src/new.ts")).toBe("Create");
    expect(editVerb("Wrote src/new.ts")).toBe("Write");
  });

  it("falls back to Edit for unknown phrasing", () => {
    expect(editVerb("Patching src/App.tsx")).toBe("Edit");
    expect(editVerb("")).toBe("Edit");
  });
});

describe("proseSummary", () => {
  it("reduces a paragraph to one plain line", () => {
    expect(
      proseSummary(
        "**Full checks pass** — `cargo fmt` and 134 tests.\n\nBumping:",
      ),
    ).toBe("Full checks pass — cargo fmt and 134 tests.");
  });

  it("skips fenced code and list markers", () => {
    expect(
      proseSummary("```ts\nconst a = 1;\n```\n\n- Ran [checks](x.md)"),
    ).toBe("Ran checks");
  });
});
