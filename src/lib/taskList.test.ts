import { describe, expect, it } from "vitest";
import {
  legacyTaskListFromText,
  normalizeTaskListStatus,
  taskListProgressLabel,
  taskListText,
} from "./taskList";

describe("task lists", () => {
  it("normalizes provider status spellings", () => {
    expect(normalizeTaskListStatus("inProgress")).toBe("in_progress");
    expect(normalizeTaskListStatus("in_progress")).toBe("in_progress");
    expect(normalizeTaskListStatus("done")).toBe("completed");
    expect(normalizeTaskListStatus("skipped")).toBe("cancelled");
    expect(normalizeTaskListStatus("unknown")).toBe("pending");
  });

  it("keeps a searchable text representation and reads legacy snapshots", () => {
    const items = [
      { text: "Inspect", status: "completed" as const },
      { text: "Implement", status: "in_progress" as const },
      { text: "Verify", status: "pending" as const },
    ];
    const text = taskListText(items);
    expect(text).toBe("[x] Inspect\n[~] Implement\n[ ] Verify");
    expect(legacyTaskListFromText(text)).toEqual(items);
    expect(legacyTaskListFromText("## Plan\n\n- Implement it")).toBeNull();
  });

  it("summarizes progress without counting cancelled tasks", () => {
    expect(
      taskListProgressLabel([
        { text: "One", status: "completed" },
        { text: "Two", status: "cancelled" },
      ]),
    ).toBe("Complete");
    expect(
      taskListProgressLabel([
        { text: "One", status: "completed" },
        { text: "Two", status: "pending" },
      ]),
    ).toBe("1 of 2");
  });
});
