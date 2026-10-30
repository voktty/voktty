import { describe, expect, it } from "vitest";
import { supportsAgyStreamInput } from "./agyProtocol";

describe("Antigravity stream input version requirement", () => {
  it.each([
    "1.1.15",
    " 1.1.15\n",
    "1.1.16",
    "1.2.0",
    "2.0.0",
    "v1.1.15",
    "Antigravity CLI 1.1.15",
    "agy version v1.1.15",
    "1.1.15+build.7",
  ])("accepts the supported release %j", (output) => {
    expect(supportsAgyStreamInput(output)).toBe(true);
  });

  it.each([
    "1.1.7",
    "1.1.14",
    "1.0.99",
    "0.99.99",
    "",
    "CLI unavailable",
    "Node 26.0.0",
    "1.1.15-preview.1",
    "1.1.15000000000000000000",
    "1.1.15\n1.1.7",
    `1.1.15+${"a".repeat(256)}`,
  ])("refuses an old or unverified release %j", (output) => {
    expect(supportsAgyStreamInput(output)).toBe(false);
  });
});
