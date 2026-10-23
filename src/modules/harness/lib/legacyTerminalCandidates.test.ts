import { expect, it } from "vitest";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { hiddenLegacyTerminals } from "@/modules/harness/lib/legacyTerminalCandidates";
import {
  newTerminalFile,
  newTerminalWorkspaceTab,
} from "@/modules/harness/lib/layout";

function fixture(project: string) {
  const visible = newTerminalFile(`${project}/visible`, "Visible");
  const hidden = newTerminalFile(`${project}/hidden`, "Hidden");
  const inactive = newTerminalFile(`${project}/other`, "Other tab");
  const dock = newTerminalFile(`${project}/dock`, "Dock");
  const activeTab = newTerminalWorkspaceTab(visible);
  activeTab.terminalPanes[0].files.push(hidden);
  const inactiveTab = newTerminalWorkspaceTab(inactive);
  const views = createHarnessWindowViews();
  const input = {
    tabs: [activeTab, inactiveTab],
    activeTabId: activeTab.id,
    projectCwd: project,
    projectTerminals: [
      {
        projectPath: project,
        side: "bottom" as const,
        size: 240,
        open: false,
        pane: { id: "dock", files: [dock], activeFileId: dock.id },
      },
    ],
    projectReturnMemory: new Map<string, string>(),
    report: {
      referencedSessionIds: [],
      foregroundSessionIds: [],
      activeSessionId: null,
    },
  };
  return { views, input, visible, hidden, inactive, dock };
}

it.each([
  "/srv/app",
  "C:/projects/app",
  "//server/share/app",
  "remote://voktty-ssh-build/srv/app",
])("selects hidden files, inactive tabs and closed docks for %s", (project) => {
  const f = fixture(project);
  f.views.register(1, f.input);
  expect(
    hiddenLegacyTerminals(f.views.getSnapshot(), project).map(
      (file) => file.id,
    ),
  ).toEqual([f.hidden.id, f.inactive.id, f.dock.id]);
});

it("never treats an alias presented in another view as a hidden terminal", () => {
  const f = fixture("/srv/app");
  f.views.register(1, f.input);
  f.views.register(2, { ...f.input, activeTabId: f.input.tabs[1].id });
  expect(
    hiddenLegacyTerminals(f.views.getSnapshot(), "/srv/app").map(
      (file) => file.id,
    ),
  ).toEqual([f.hidden.id, f.dock.id]);
});

it("includes retained cohorts without treating their last selected file as a live presentation", () => {
  const f = fixture("/srv/app");
  f.views.register(1, f.input).release();
  expect(
    hiddenLegacyTerminals(f.views.getSnapshot(), "/srv/app").map(
      (file) => file.id,
    ),
  ).toContain(f.visible.id);
});

it("does not infer project ownership for an unrelated folder, escaped folder or remote namespace", () => {
  const f = fixture("remote://voktty-ssh-build/srv/app");
  const pane = f.input.tabs[0].terminalPanes[0];
  pane.files.push(
    newTerminalFile("remote://voktty-ssh-other/srv/app/x", "Other host"),
    newTerminalFile("remote://voktty-ssh-build/srv/app/../outside", "Outside"),
    newTerminalFile("/srv/app/ambiguous", "No namespace"),
  );
  f.views.register(1, f.input);
  const files = hiddenLegacyTerminals(
    f.views.getSnapshot(),
    f.input.projectCwd,
  );
  expect(files.map((file) => file.path)).toEqual([
    "Hidden",
    "Other tab",
    "Dock",
  ]);
  expect(hiddenLegacyTerminals(f.views.getSnapshot(), "/another")).toEqual([]);
});

it("can enumerate potentially presented metadata when the caller independently requires empty native resources", () => {
  const f = fixture("/srv/app");
  f.views.register(1, f.input);
  expect(
    hiddenLegacyTerminals(f.views.getSnapshot(), "/srv/app", true).map(
      (file) => file.id,
    ),
  ).toEqual([f.visible.id, f.hidden.id, f.inactive.id, f.dock.id]);
});
