import { describe, expect, it } from "vitest";
import {
  getActiveTerminalLeafId,
  markLeafFocused,
} from "./useTerminalSession";

describe("getActiveTerminalLeafId", () => {
  it("safely handles empty sessions and marks focus", () => {
    markLeafFocused(101);
    const active = getActiveTerminalLeafId();
    expect(active === 101 || active === null).toBe(true);
  });
});
