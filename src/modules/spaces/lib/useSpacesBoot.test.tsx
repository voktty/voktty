// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSpacesBoot } from "./useSpacesBoot";

const mocks = vi.hoisted(() => ({
  refreshLaunchBootstrap: vi.fn(),
}));

vi.mock("@/lib/launchRequest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/launchRequest")>()),
  refreshLaunchBootstrap: mocks.refreshLaunchBootstrap,
}));
vi.mock("@/modules/tabs/lib/useTabs", () => ({
  DEFAULT_SPACE_ID: "default",
  NO_ACTIVE_TAB_ID: -1,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  mocks.refreshLaunchBootstrap.mockReset();
});

it("does not mark a failed restore as booted and permits a retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.refreshLaunchBootstrap.mockRejectedValue(new Error("restore failed"));
  const markBooted = vi.fn();
  const replaceTabs = vi.fn();
  let boot!: ReturnType<typeof useSpacesBoot>;

  function Harness() {
    boot = useSpacesBoot({
      ready: true,
      initialRequest: null,
      launchCwd: null,
      home: null,
      allocId: () => 1,
      replaceTabs,
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv: async () => null,
    });
    return null;
  }

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => {
      root?.render(createElement(Harness));
    });
    expect(boot.bootError).toBe(true);
    expect(markBooted).not.toHaveBeenCalled();
    expect(replaceTabs).not.toHaveBeenCalled();

    await act(async () => {
      boot.retryBoot();
    });
    expect(mocks.refreshLaunchBootstrap).toHaveBeenCalledTimes(2);
    expect(boot.bootError).toBe(true);
    expect(markBooted).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
