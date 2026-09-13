import { describe, expect, it } from "vitest";
import {
  newChangesTab,
  newReleaseNotesWorkspaceTab,
  newSessionChangesTab,
  type FilePaneTab,
} from "../lib/layout";
import { releaseNotesTitle } from "../lib/releaseNotes";
import {
  appendProblems,
  surfaceTabMenuItems,
  surfaceTabPresentation,
} from "./SurfaceTabs";

const t = (key: string, values?: Record<string, string | number>) => {
  const name = String(values?.name ?? "");
  const count = Number(values?.count ?? 0);
  const texts: Record<string, string> = {
    "harness.chrome.changes": "Changes",
    "harness.chrome.workingTreeChanges": "Working tree changes",
    "harness.chrome.sessionChanges": "Session Changes",
    "harness.chrome.sessionChangesTooltip": "Changes captured for this session only",
    "harness.chrome.tabProblems": `${values?.title} — ${count} ${count === 1 ? "problem" : "problems"}`,
    "harness.chrome.workingTreeNamed": `${name} (Working Tree)`,
  };
  return texts[key] ?? key;
};

describe("surfaceTabPresentation", () => {
  it("labels release notes from their version", () => {
    const file = newReleaseNotesWorkspaceTab({ version: "0.1.23" })
      .editorPanes[0]?.files[0];
    if (!file) throw new Error("expected release-note file");

    expect(surfaceTabPresentation(file, t)).toEqual({
      name: releaseNotesTitle("0.1.23"),
      label: releaseNotesTitle("0.1.23"),
      iconName: "CHANGELOG.md",
      tooltip: releaseNotesTitle("0.1.23"),
    });
  });

  it("labels working-tree changes tab", () => {
    const file = newChangesTab("/workspace/repo");
    expect(surfaceTabPresentation(file, t)).toEqual({
      name: "Changes",
      label: "Changes",
      iconName: "CHANGES",
      tooltip: "Working tree changes",
    });
  });

  it("labels session-scoped changes tab", () => {
    const file = newSessionChangesTab("/workspace/repo", "session-42");
    expect(surfaceTabPresentation(file, t)).toEqual({
      name: "Session Changes",
      label: "Session Changes",
      iconName: "CHANGES",
      tooltip: "Changes captured for this session only",
    });
  });
});

describe("appendProblems", () => {
  it("leaves a clean file's tooltip alone", () => {
    expect(appendProblems(t, "/repo/src/app.ts", 0)).toBe("/repo/src/app.ts");
  });

  it("singularises a lone problem", () => {
    expect(appendProblems(t, "/repo/src/app.ts", 1)).toBe(
      "/repo/src/app.ts — 1 problem",
    );
  });

  it("pluralises the rest", () => {
    expect(appendProblems(t, "/repo/src/app.ts", 4)).toBe(
      "/repo/src/app.ts — 4 problems",
    );
  });
});

describe("surfaceTabMenuItems", () => {
  const file: FilePaneTab = {
    id: "f1",
    path: "/repo/src/index.ts",
    cwd: "/repo",
  };

  it("includes Close and Close Others enabled when canCloseOthers is true", () => {
    const items = surfaceTabMenuItems(file, (key) => key, true);
    const closeOthers = items.find(
      (i) => i.kind === "item" && i.id === "close-others",
    );
    expect(closeOthers).toBeDefined();
    if (closeOthers && closeOthers.kind === "item") {
      expect(closeOthers.disabled).toBe(false);
    }
  });

  it("disables Close Others when canCloseOthers is false", () => {
    const items = surfaceTabMenuItems(file, (key) => key, false);
    const closeOthers = items.find(
      (i) => i.kind === "item" && i.id === "close-others",
    );
    expect(closeOthers).toBeDefined();
    if (closeOthers && closeOthers.kind === "item") {
      expect(closeOthers.disabled).toBe(true);
    }
  });
});
