import { describe, expect, it } from "vitest";
import {
  canOptOutOfAppClosePrompt,
  promoteSessionThenExit,
} from "./useAppCloseGuard";

describe("canOptOutOfAppClosePrompt", () => {
  it("offers the opt-out when a running process is the only blocker", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 0, busyTerminal: true }),
    ).toBe(true);
  });

  it("withholds the opt-out whenever unsaved changes are also at stake", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 1, busyTerminal: true }),
    ).toBe(false);
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 2, busyTerminal: false }),
    ).toBe(false);
  });
});

describe("promoteSessionThenExit", () => {
  it("exits only after a clean session was promoted", async () => {
    const order: string[] = [];

    await promoteSessionThenExit(
      async () => {
        order.push("promote");
      },
      async () => {
        order.push("exit");
      },
    );

    expect(order).toEqual(["promote", "exit"]);
  });

  it("does not exit when promotion fails", async () => {
    let exited = false;

    await expect(
      promoteSessionThenExit(
        async () => {
          throw new Error("store failed");
        },
        async () => {
          exited = true;
        },
      ),
    ).rejects.toThrow("store failed");
    expect(exited).toBe(false);
  });
});
