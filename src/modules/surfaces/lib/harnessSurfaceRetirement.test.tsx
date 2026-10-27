// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  publishHarnessFocusFolder,
  publishHarnessProject,
  useHarnessSurfaceStore,
} from "@/modules/surfaces/lib/harnessSurfaceStore";
import { useHarnessDesktopContext } from "@/modules/surfaces/lib/useHarnessDesktopContext";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { HarnessTab } from "@/modules/tabs";

afterEach(() => {
  useHarnessSurfaceStore.setState({ reports: {} });
  vi.unstubAllGlobals();
});

it("publishes owned reports without emitting either retired folder event", () => {
  const listener = vi.fn();
  const names = ["voktty:harness-cwd-change", "voktty:harness-focus-folder"];
  for (const name of names) window.addEventListener(name, listener);
  try {
    publishHarnessProject("/owned", 1);
    publishHarnessFocusFolder("/owned/src", 1);
    expect(useHarnessSurfaceStore.getState().reports[1]).toEqual({
      projectCwd: "/owned",
      focusFolder: "/owned/src",
    });
    expect(listener).not.toHaveBeenCalled();
  } finally {
    for (const name of names) window.removeEventListener(name, listener);
  }
});

it("has no ownerless directory projection and rejects unowned JavaScript publication", () => {
  const state = useHarnessSurfaceStore.getState();
  expect(state).not.toHaveProperty("projectCwd");
  expect(state).not.toHaveProperty("focusFolder");
  Reflect.apply(publishHarnessProject, undefined, ["/unowned"]);
  Reflect.apply(publishHarnessFocusFolder, undefined, ["/unowned/src"]);
  expect(useHarnessSurfaceStore.getState().reports).toEqual({});
});

it("never routes raw folder events into a mounted desktop reader or its selected tab", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const tab: HarnessTab = {
    ...createTabIdentity("main", () => "owner"),
    id: 1,
    kind: "harness",
    title: "Harness",
    spaceId: "main",
    cwd: "/owned",
  };
  const updateTab = vi.fn();
  let context: ReturnType<typeof useHarnessDesktopContext> | undefined;
  function Desktop() {
    context = useHarnessDesktopContext({
      activeTab: tab,
      tabsRef: { current: [tab] },
      updateTab,
      lastProjectPath: () => null,
    });
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <Desktop />
        </StrictMode>,
      ),
    );
    await act(async () => {
      for (const ownerId of [1, 2, undefined]) {
        window.dispatchEvent(
          new CustomEvent("voktty:harness-cwd-change", {
            detail: { cwd: "/injected", ownerId },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("voktty:harness-focus-folder", {
            detail: { cwd: "/injected/src", ownerId },
          }),
        );
      }
    });
    expect(updateTab).not.toHaveBeenCalled();
    expect(context?.folder).toBe("/owned");
    expect(useHarnessSurfaceStore.getState().reports).toEqual({});
  } finally {
    await act(async () => root.unmount());
  }
});
