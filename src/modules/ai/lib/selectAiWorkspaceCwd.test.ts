import { expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { selectAiWorkspaceCwd } from "./selectAiWorkspaceCwd";

const otherTerminal = {
  kind: "terminal",
  cwd: "/other",
  activeLeafId: 2,
  paneTree: { kind: "leaf", id: 2, cwd: "/other" },
} as Tab;

it("uses the active development project instead of an unrelated terminal", () => {
  const harness = { kind: "harness", cwd: "C:/projects/site" } as Tab;
  expect(selectAiWorkspaceCwd(harness, [harness, otherTerminal], null)).toBe(
    "C:/projects/site",
  );
});

it("keeps a remote project identity instead of silently falling back to local tools", () => {
  const harness = { kind: "harness", cwd: "remote://host/srv/site" } as Tab;
  expect(selectAiWorkspaceCwd(harness, [otherTerminal, harness], null)).toBe(
    "remote://host/srv/site",
  );
});

it("uses the project fallback when a development tab has no stored cwd", () => {
  expect(
    selectAiWorkspaceCwd(
      { kind: "harness" } as Tab,
      [otherTerminal],
      "/project",
    ),
  ).toBe("/project");
});
