import { expect, it } from "vitest";
import { isTerminalTitle } from "@/modules/tabs/lib/terminalTitle";

it("accepts an exact nonblank Unicode label up to the persisted custom-title limit", () => {
  for (const title of ["  Build / producción  ", "x".repeat(4096)])
    expect(isTerminalTitle(title)).toBe(true);
});

it("rejects controls, blank, oversized and non-string labels", () => {
  for (const title of [
    undefined,
    null,
    42,
    {},
    "",
    " \t ",
    "x".repeat(4097),
    ...Array.from(
      { length: 32 },
      (_, code) => `Build${String.fromCharCode(code)}`,
    ),
    "Build\x7f",
  ])
    expect(isTerminalTitle(title)).toBe(false);
});
