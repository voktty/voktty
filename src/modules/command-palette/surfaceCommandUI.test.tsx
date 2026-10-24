// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandPalette } from "@/modules/command-palette/CommandPalette";
import { ToolLauncher } from "@/modules/launcher/ToolLauncher";
import { useLauncherStore } from "@/modules/launcher/store";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";
import { TerminalIcon } from "@hugeicons/core-free-icons";

const label = (key: string) => key;
vi.mock("@/modules/i18n", () => ({ useTranslation: () => ({ t: label }) }));
vi.mock("@/modules/settings/preferences", () => ({ usePreferencesStore: () => ({}) }));
vi.mock("@/modules/command-palette/commands", () => ({ COMMAND_GROUPS: ["Editor", "General"] }));
vi.mock("@/modules/command-palette/hooks/useCommandHistory", () => ({ useCommandHistory: () => ({ results: [] }) }));
vi.mock("@/modules/command-palette/hooks/useContentSearch", () => ({ useContentSearch: () => ({ results: [] }) }));
vi.mock("@/modules/theme", () => ({
  DEFAULT_THEME_ID: "default", listBuiltinThemes: () => [],
  useTheme: () => ({ customThemes: [], previewThemeId: () => {}, previewVariation: () => {} }),
}));
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/command", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Command: Box, CommandDialog: Box, CommandGroup: Box, CommandList: Box, CommandShortcut: Box,
    CommandInput: () => <input />,
    CommandItem: ({ children, onSelect, disabled }: { children: ReactNode; onSelect?: () => void; disabled?: boolean }) =>
      <button type="button" disabled={disabled} onClick={onSelect}>{children}</button>,
  };
});
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: Box, DialogContent: Box, DialogDescription: Box, DialogHeader: Box, DialogTitle: Box };
});
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  publishActiveSurface(null);
  useLauncherStore.getState().closeLauncher();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const button = (title: string) => {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(title));
  if (!found) throw new Error(`Missing command ${title}`);
  return found;
};

it("updates palette reasons and refuses its deferred callback after close changes the owner", async () => {
  const run = vi.fn();
  publishActiveSurface({ kind: "harness", ownerId: 1, projectCwd: "remote://machine/project" });
  await act(async () => root.render(<CommandPalette open onOpenChange={() => {
    publishActiveSurface({ kind: "harness", ownerId: 3, projectCwd: "/other" });
  }} commandItems={[{ id: "editor.find", group: "Editor", title: "Find document", run }]}
    workspaceRoot={null} onOpenContentHit={() => {}} insertCommand={null} />));
  expect(button("Find document").disabled).toBe(true);
  expect(container.textContent).toContain("commandPalette.disabled.noEditorTab");
  await act(async () => publishActiveSurface({ kind: "editor", ownerId: 2, folder: "/project" }));
  expect(button("Find document").disabled).toBe(false);
  await act(async () => { button("Find document").click(); await vi.advanceTimersByTimeAsync(0); });
  expect(run).not.toHaveBeenCalled();
});

it("shows the same reason in the launcher and runs a newly eligible command", async () => {
  const run = vi.fn();
  publishActiveSurface({ kind: "harness", ownerId: 1, projectCwd: "/project" });
  useLauncherStore.getState().openLauncher();
  await act(async () => root.render(<ToolLauncher items={[{
    id: "launch.outline", group: "development", title: "Outline", icon: TerminalIcon, run,
  }]} />));
  expect(button("Outline").disabled).toBe(true);
  expect(container.textContent).toContain("commandPalette.disabled.noEditorTab");
  await act(async () => publishActiveSurface({ kind: "editor", ownerId: 2, folder: "remote://machine/project" }));
  expect(button("Outline").disabled).toBe(false);
  await act(async () => button("Outline").click());
  expect(run).toHaveBeenCalledOnce();
});

it("runs an admitted palette command after closing while its surface remains current", async () => {
  const run = vi.fn();
  publishActiveSurface({ kind: "editor", ownerId: 1, folder: "/project" });
  await act(async () => root.render(<CommandPalette open onOpenChange={() => {}}
    commandItems={[{ id: "editor.find", group: "Editor", title: "Find document", run }]}
    workspaceRoot={null} onOpenContentHit={() => {}} insertCommand={null} />));
  await act(async () => { button("Find document").click(); await vi.advanceTimersByTimeAsync(0); });
  expect(run).toHaveBeenCalledOnce();
});
