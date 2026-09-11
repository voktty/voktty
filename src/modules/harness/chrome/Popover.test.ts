import { describe, expect, it } from "vitest";
import { POPOVER_CONTENT_CLASS, POPOVER_FRAME_CLASS } from "./Popover";

describe("Popover theme contract", () => {
  it("uses Voktty semantic surfaces instead of a Harness-only tint", () => {
    expect(POPOVER_FRAME_CLASS).toContain("voktty-floating-surface");
    expect(POPOVER_CONTENT_CLASS).toContain("text-popover-foreground");
    expect(POPOVER_CONTENT_CLASS).not.toContain("text-zinc-100");
    expect(POPOVER_FRAME_CLASS).not.toContain("backdrop-blur-xl");
  });
});
