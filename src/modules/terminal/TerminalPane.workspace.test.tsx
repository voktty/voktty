// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalPane } from "@/modules/terminal/TerminalPane";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  popup: vi.fn(),
  phase: "failed",
}));
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  useLeafWorkspaceEnv: mocks.workspace,
  leafCwd: () => null,
  focusLeafInput: vi.fn(),
  submitToLeaf: vi.fn(),
  useTerminalSession: () => ({
    applyTheme: vi.fn(),
    write: vi.fn(),
    focus: vi.fn(),
    getBuffer: vi.fn(),
    getSelection: vi.fn(),
    blockMode: "prompt",
    connectionState: { phase: mocks.phase, attempt: 1, error: null },
    failedExit: null,
    subscribeBlocks: vi.fn(),
    visibleBlocks: vi.fn(),
    readBlockId: vi.fn(),
    searchBlock: vi.fn(),
    revealMatch: vi.fn(),
    clearSearch: vi.fn(),
    clearFailedExit: vi.fn(),
    respawn: vi.fn(),
    cancelConnection: vi.fn(),
  }),
}));
vi.mock("@/modules/theme", () => ({
  useTheme: () => ({ resolvedMode: "dark", activeTheme: {} }),
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) =>
      params?.name ? `${key}:${params.name}` : key,
  }),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (selector: (state: object) => unknown) =>
    selector({ windowVibrancy: "none", vibrancyOpacity: 100 }),
}));
vi.mock("@/modules/mobile", () => ({
  ExtraKeysBar: () => null,
  useResponsiveLayout: () => ({ isTouch: false, isTablet: false }),
  useTerminalTouch: vi.fn(),
}));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  useAiAvailable: () => false,
}));
vi.mock("@/modules/shortcuts/lib/useShortcutLabel", () => ({
  useShortcutLabel: () => "Ctrl+J",
}));
vi.mock("@/modules/terminal/scripts/ProjectScriptsHud", () => ({
  ProjectScriptsHud: () => null,
}));
vi.mock("@/modules/terminal/block/BlockOverlay", () => ({
  BlockOverlay: () => null,
}));
vi.mock("@/modules/terminal/block/BlockWatermark", () => ({
  BlockWatermark: () => null,
}));
vi.mock("@/modules/terminal/TerminalInlineSuggest", () => ({
  TerminalInlineSuggest: () => null,
}));
vi.mock("@/modules/terminal/TerminalScrollBottomHud", () => ({
  TerminalScrollBottomHud: () => null,
}));
vi.mock("@/modules/collab/components/GuestSessionBadge", () => ({
  GuestSessionBadge: () => null,
}));
vi.mock("@/modules/collab/components/HostSessionBadge", () => ({
  HostSessionBadge: () => null,
}));
vi.mock("@/modules/terminal/copilot/terminalCopilotStore", () => ({
  useTerminalCopilotStore: (selector: (state: object) => unknown) =>
    selector({ isOpen: true, leafId: 1, initialPrompt: null, close: vi.fn() }),
}));
vi.mock("@/modules/terminal/copilot/TerminalCopilotPopupLazy", () => ({
  TerminalCopilotPopupLazy: (props: { workspaceEnv: WorkspaceEnv }) => {
    mocks.popup(props.workspaceEnv);
    return null;
  },
}));

function workspace(id: number, name: string): WorkspaceEnv {
  return {
    kind: "ssh",
    root: "/srv/app",
    sessionId: id,
    connection: { id: "build", host: "build.example", name },
  };
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.phase = "failed";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "gives copilot and status the runtime environment instead of the inherited helper, blocks=%s",
  async (blocks) => {
    const inherited = workspace(7, "Original");
    const resolved = workspace(8, "Current");
    mocks.workspace.mockReturnValue(resolved);
    await act(async () =>
      root.render(
        <TerminalPane
          leafId={1}
          visible
          workspaceEnv={inherited}
          blocks={blocks}
        />,
      ),
    );
    expect(mocks.workspace).toHaveBeenCalledWith(1);
    expect(mocks.popup).toHaveBeenLastCalledWith(resolved);
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "terminal.connection.failed:Current",
    );
    expect(container.textContent).not.toContain("Original");
  },
);

it("preserves the captured launch environment when no runtime is available", async () => {
  const inherited = workspace(7, "Original");
  mocks.workspace.mockReturnValue(undefined);
  await act(async () =>
    root.render(<TerminalPane leafId={1} visible workspaceEnv={inherited} />),
  );
  expect(mocks.popup).toHaveBeenLastCalledWith(inherited);
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "terminal.connection.failed:Original",
  );
});
