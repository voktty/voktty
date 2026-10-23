import { expect, it } from "vitest";
import { terminalProjectMetadata } from "@/modules/tabs/lib/terminalProject";

it.each([
  "/srv/app",
  "C:/work/app",
  "//server/share/app",
  "remote://voktty-ssh-build/srv/app",
  "remote://profile%2Fid/",
  "/",
])("keeps the bounded absolute project identity %s", (path) => {
  expect(terminalProjectMetadata(path)).toEqual({ projectCwd: path });
});
it("normalizes Windows separators without lowercasing project names", () => {
  expect(terminalProjectMetadata("C:\\Work\\App")).toEqual({
    projectCwd: "C:/Work/App",
  });
});
it.each([
  undefined,
  null,
  7,
  {},
  [],
  "",
  "relative/app",
  "~",
  "https://example.test/app",
  "remote://user:password@host/app",
  "remote://missing",
  "/bad\0path",
  "/bad\npath",
  "/".repeat(32769),
])(
  "rejects malformed, oversized or credential-bearing metadata case %#",
  (value) => {
    expect(terminalProjectMetadata(value)).toEqual({});
  },
);
it("does not attach a remote identity to a local transport or a native path to SSH", () => {
  expect(
    terminalProjectMetadata("remote://build/srv/app", { kind: "local" }),
  ).toEqual({});
  expect(
    terminalProjectMetadata("/srv/app", {
      kind: "ssh",
      root: "/srv/app",
      connection: { id: "build", name: "Build", host: "build.example" },
    }),
  ).toEqual({});
});
