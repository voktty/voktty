import { describe, expect, it } from "vitest";
import type { Block } from "../lib/session";
import {
  groupTurnItems,
  groupTurns,
  splitActivityRows,
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
