import { describe, expect, it } from "vitest";
import { MAX_PANES_PER_TAB, RENDERER_POOL_SIZE } from "./paneLimits";

describe("terminal pane limits", () => {
  it("allows eight panes per tab", () => {
    expect(MAX_PANES_PER_TAB).toBe(8);
  });

  it("keeps one spare renderer slot beyond the pane limit", () => {
    expect(RENDERER_POOL_SIZE).toBe(MAX_PANES_PER_TAB + 1);
  });
});
