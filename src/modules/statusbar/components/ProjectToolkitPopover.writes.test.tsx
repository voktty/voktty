// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectToolkitPopover } from "@/modules/statusbar/components/ProjectToolkitPopover";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
const io = vi.hoisted(() => ({
  listen: vi.fn(),
  tools: vi.fn(),
  skills: vi.fn(),
}));
const preferences = vi.hoisted(() => ({
  lspActivation: {},
  lspCustomServers: [],
}));
let configWorkspace: WorkspaceEnv;
let configFilePath: string;
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (state: object) => unknown) =>
    select(preferences),
}));
vi.mock("@/modules/lsp", () => ({ allServers: () => [] }));
vi.mock("@/settings/components/LspInstallDialog", () => ({
  LspInstallDialog: () => null,
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: io.listen }),
}));
vi.mock("@/modules/statusbar/lib/useProjectToolkit", () => ({
  useProjectToolkit: () => ({
    tools: [],
    skills: [],
    stackInfo: null,
    configFilePath,
    configWorkspace,
    reloadTools: io.tools,
    reloadSkills: io.skills,
    editConfig: vi.fn(),
    openSkill: vi.fn(),
  }),
}));
vi.mock("@/components/ui/popover", () => {
  const Part = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    Popover: ({
      children,
      onOpenChange,
    }: PropsWithChildren<{ onOpenChange: (open: boolean) => void }>) => (
      <>
        <button type="button" onClick={() => onOpenChange(true)}>
          Open
        </button>
        {children}
      </>
    ),
    PopoverContent: Part,
    PopoverTrigger: Part,
  };
});
vi.mock("@/components/ui/tooltip", () => {
  const Part = ({ children }: PropsWithChildren) => <>{children}</>;
  return { Tooltip: Part, TooltipContent: Part, TooltipTrigger: Part };
});
let root: Root;
let node: HTMLDivElement;
let callback: (event: { payload: unknown }) => void;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  io.listen.mockImplementation(async (_name, handler) => {
    callback = handler;
    return () => {};
  });
  configWorkspace = { kind: "wsl", distro: "first" };
  configFilePath = "/work/.voktty/tools.json";
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
async function render(
  workspace: WorkspaceEnv = { kind: "wsl", distro: "first" },
) {
  await act(async () =>
    root.render(
      <ProjectToolkitPopover
        cwd="/work"
        workspace={workspace}
        onOpenSettings={() => {}}
      />,
    ),
  );
  await act(async () =>
    [...node.querySelectorAll("button")]
      .find((button) => button.textContent === "Open")
      ?.click(),
  );
}
function event(path = configFilePath, filesystem: object = { kind: "local" }) {
  return { payload: { path, source: "editor", filesystem } };
}
it("reloads only the actual configuration target's filesystem and path", async () => {
  await render();
  callback(event());
  callback(event(configFilePath, { kind: "wsl", distro: "second" }));
  callback(
    event("/other/.voktty/tools.json", { kind: "wsl", distro: "first" }),
  );
  expect(io.tools).not.toHaveBeenCalled();
  callback(event(configFilePath, { kind: "wsl", distro: "first" }));
  expect(io.tools).toHaveBeenCalledOnce();
});
it("still reloads a native global config used by a remote project", async () => {
  configWorkspace = LOCAL_WORKSPACE;
  configFilePath = "/config/project-tools.json";
  await render({
    kind: "ssh",
    root: "/work",
    connection: { id: "fixture", name: "Fixture", host: "example.test" },
  });
  callback(event());
  expect(io.tools).toHaveBeenCalledOnce();
});
it("retires cached listener callbacks on close or unmount", async () => {
  configWorkspace = LOCAL_WORKSPACE;
  await render(LOCAL_WORKSPACE);
  await act(async () => root.render(null));
  callback(event());
  expect(io.tools).not.toHaveBeenCalled();
  expect(io.skills).not.toHaveBeenCalled();
});
