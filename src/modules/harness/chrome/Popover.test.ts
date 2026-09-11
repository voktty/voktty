import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POPOVER_CONTENT_CLASS, POPOVER_FRAME_CLASS } from "./Popover";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./Popover.tsx", import.meta.url)),
  "utf8",
);

describe("Popover theme contract", () => {
  it("uses Voktty semantic surfaces instead of a Harness-only tint", () => {
    expect(POPOVER_FRAME_CLASS).toContain("voktty-floating-surface");
    expect(POPOVER_CONTENT_CLASS).toContain("text-popover-foreground");
    expect(POPOVER_CONTENT_CLASS).not.toContain("text-zinc-100");
    expect(POPOVER_FRAME_CLASS).not.toContain("backdrop-blur-xl");
  });

  it("has no unthemed frame variant", () => {
    expect(SOURCE).not.toContain("bare?: boolean");
    expect(SOURCE).not.toContain("bare ? undefined");
  });
});
