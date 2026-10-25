import { expect, it } from "vitest";
import { supportsDocumentFormatting } from "@/modules/surfaces/lib/documentFormatting";

it.each([
  ["/project/file.ts", "local", false, true],
  ["/project/file.ts", "ssh", false, false],
  ["/project/file.ts", "docker", false, false],
  ["/project/file.ts", "serial", false, false],
  ["/project/file.ts", "remote", false, false],
  ["/project/file.ts", "wsl", false, false],
  ["/project/file.ts", "wsl", true, true],
  ["remote://machine/project/file.ts", "local", false, false],
  ["remote://machine/project/file.ts", "ssh", true, false],
  ["C:/project/file.ts", "wsl", true, true],
  ["C:/project/file.ts", "ssh", true, true],
  ["\\\\server\\share\\file.ts", "wsl", true, true],
  ["relative.ts", "local", false, false],
  ["/project/bad\nfile.ts", "local", false, false],
  ["/project/bad\0file.ts", "local", false, false],
  [null, "local", false, false],
] as const)(
  "projects formatting support for %s in %s on windows=%s",
  (path, kind, windows, expected) => {
    expect(supportsDocumentFormatting(path, { kind }, windows)).toBe(expected);
  },
);
it("bounds path input without changing the accepted maximum", () => {
  expect(
    supportsDocumentFormatting(`/${"x".repeat(32767)}`, { kind: "local" }),
  ).toBe(true);
  expect(
    supportsDocumentFormatting(`/${"x".repeat(32768)}`, { kind: "local" }),
  ).toBe(false);
});
