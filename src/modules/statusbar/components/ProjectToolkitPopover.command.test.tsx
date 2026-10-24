// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectToolkitPopover } from "@/modules/statusbar/components/ProjectToolkitPopover";

const action = vi.hoisted(() => ({
  id: "test",
  category: "ai",
  name: "Example",
  command: "echo example",
}));
vi.mock("@/modules/harness/lib/fs", () => ({ listSkills: async () => [] }));
vi.mock("@/modules/lsp", () => ({
  allServers: () => [],
  useLspRuntimeStore: vi.fn(),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (state: object) => unknown) =>
    select({ lspActivation: {}, lspCustomServers: [] }),
}));
vi.mock("@/settings/components/LspInstallDialog", () => ({
  LspInstallDialog: () => null,
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/statusbar/lib/detectProjectStack", () => ({
  detectProjectStack: async () => null,
}));
vi.mock("@/modules/statusbar/lib/toolsConfigFile", () => ({
  DEFAULT_PROJECT_TOOLS: [action],
  loadToolsConfigFile: async () => [action],
  getProjectToolsFilePath: async () => "/project/tools.json",
  ensureToolsConfigFile: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: async () => () => {} }),
}));
vi.mock("@/components/ui/popover", () => {
  const Part = ({ children }: PropsWithChildren) => <>{children}</>;
  return { Popover: Part, PopoverContent: Part, PopoverTrigger: Part };
});
vi.mock("@/components/ui/tooltip", () => {
  const Part = ({ children }: PropsWithChildren) => <>{children}</>;
  return { Tooltip: Part, TooltipContent: Part, TooltipTrigger: Part };
});
let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function render(run?: (command: string) => boolean, reason?: string) {
  await act(async () =>
    root.render(
      <ProjectToolkitPopover
        cwd="/project"
        onOpenSettings={() => {}}
        onRunCommand={run}
        runCommandDisabledReason={reason}
      />,
    ),
  );
}
function runButton() {
  const button = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("projectToolkit.run"),
  );
  if (!button) throw new Error("Missing run action");
  return button;
}
it("shows the unavailable reason while keeping copy available", async () => {
  const run = vi.fn(() => true);
  await render(run, "Unavailable terminal");
  const button = runButton();
  expect(button.disabled).toBe(true);
  expect(node.textContent).toContain("Unavailable terminal");
  expect(
    node.querySelector<HTMLButtonElement>(
      '[title="projectToolkit.copyCommand"]',
    )?.disabled,
  ).toBe(false);
  await act(async () => button.click());
  expect(run).not.toHaveBeenCalled();
});
it("disables execution when no command target is supplied", async () => {
  await render();
  expect(runButton().disabled).toBe(true);
  expect(node.textContent).toContain("editor.terminalNoActive");
});
it.each([false, true])(
  "publishes sent feedback only when admission is %s",
  async (accepted) => {
    const run = vi.fn(() => accepted);
    await render(run);
    await act(async () => runButton().click());
    expect(run).toHaveBeenCalledExactlyOnceWith("echo example");
    expect(node.textContent?.includes("projectToolkit.sent")).toBe(accepted);
  },
);
