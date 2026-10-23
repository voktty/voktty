import { expect, it, vi } from "vitest";
import {
  newEditorPane,
  newTerminalFile,
  newTerminalWorkspaceTab,
} from "@/modules/harness/lib/layout";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  createProjectTerminal,
  projectTerminalFileIds,
} from "@/modules/harness/lib/projectTerminal";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "@/modules/harness/lib/terminalClose";
import { reapWindowRuntime } from "@/modules/harness/lib/appLifecycle";

const legacy = vi.hoisted(() => ({
  status: vi.fn(),
  kill: vi.fn().mockResolvedValue(undefined),
  killChildren: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/harness/lib/pty", () => ({
  getPtyStatus: legacy.status,
  killPty: legacy.kill,
}));
vi.mock("@/modules/harness/lib/harness/child", () => ({
  killAllChildren: legacy.killChildren,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
const canonical = {
  ...newTerminalFile("/srv/app"),
  canonicalTerminal: { tabKey: asTabKey("tab-shell"), projectCwd: "/srv/app" },
};
it("never consults the legacy PTY registry for canonical close confirmation", async () => {
  await expect(confirmCloseTerminal(canonical)).resolves.toBe(true);
  await expect(confirmCloseTerminals([canonical])).resolves.toBe(true);
  expect(legacy.status).not.toHaveBeenCalled();
});
it("excludes canonical resources from legacy window reaping while preserving legacy cleanup", async () => {
  const old = newTerminalFile("/srv/app");
  const tab = newTerminalWorkspaceTab(canonical);
  const mixed = { ...tab, editorPanes: [newEditorPane(canonical)] };
  const docks = [
    createProjectTerminal("/srv/app", canonical),
    createProjectTerminal("/srv/old", old),
  ];
  expect(projectTerminalFileIds(docks)).toEqual([old.id]);
  await reapWindowRuntime([], [mixed], docks);
  expect(legacy.kill).toHaveBeenCalledExactlyOnceWith(old.id);
});
