import { expect, it } from "vitest";
import {
  fileWrittenMatches,
  fileWrittenWithin,
  parseFileWritten,
} from "@/modules/workspace/fileWritten";
const local = { kind: "local" } as const;
const event = { path: "/work/file.ts", filesystem: local };
it("keeps local and WSL distributions distinct", () => {
  expect(fileWrittenMatches(event, event.path, local)).toBe(true);
  expect(
    fileWrittenMatches(event, event.path, { kind: "wsl", distro: "first" }),
  ).toBe(false);
  const wsl = {
    ...event,
    filesystem: { kind: "wsl", distro: "first" } as const,
  };
  expect(
    fileWrittenMatches(wsl, event.path, { kind: "wsl", distro: "first" }),
  ).toBe(true);
  expect(
    fileWrittenMatches(wsl, event.path, { kind: "wsl", distro: "second" }),
  ).toBe(false);
});
it.each([
  undefined,
  null,
  { path: event.path },
  { ...event, filesystem: { kind: "ssh" } },
  { ...event, filesystem: { kind: "wsl", distro: "" } },
  { ...event, path: "x".repeat(32769) },
])("rejects missing or malformed event identities", (value) => {
  expect(parseFileWritten(value)).toBeNull();
});
it("copies only the bounded event fields", () => {
  expect(
    parseFileWritten({
      ...event,
      connection: { host: "fixture" },
      filesystem: { kind: "local", secret: "fixture" },
    }),
  ).toEqual(event);
});
it("folds native Windows paths but preserves POSIX case and backslashes", () => {
  expect(
    fileWrittenMatches(
      { ...event, path: "C:\\WORK\\file.ts" },
      "c:/work/FILE.ts",
      { kind: "wsl", distro: "first" },
    ),
  ).toBe(true);
  expect(
    fileWrittenMatches(
      { ...event, path: "\\\\HOST\\SHARE\\file.ts" },
      "//host/share/FILE.ts",
      local,
    ),
  ).toBe(true);
  expect(fileWrittenMatches(event, "/work/FILE.ts", local)).toBe(false);
  expect(
    fileWrittenMatches(
      { ...event, path: "/work/back\\slash" },
      "/work/back/slash",
      local,
    ),
  ).toBe(false);
});
it("does not treat remote namespaces or unsupported filesystems as native", () => {
  expect(
    fileWrittenMatches(
      { ...event, path: "remote://fixture/work/file.ts" },
      "remote://fixture/work/file.ts",
      local,
    ),
  ).toBe(false);
  expect(
    fileWrittenMatches(event, event.path, {
      kind: "ssh",
      root: "/work",
      connection: { id: "fixture", name: "Fixture", host: "example.test" },
    }),
  ).toBe(false);
});
it("matches root boundaries without conflating sibling projects", () => {
  expect(fileWrittenWithin(event, "", local)).toBe(false);
  expect(fileWrittenWithin(event, "/work", local)).toBe(true);
  expect(fileWrittenWithin(event, "/", local)).toBe(true);
  expect(fileWrittenWithin(event, "/wor", local)).toBe(false);
});
