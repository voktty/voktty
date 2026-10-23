// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessTab } from "@/modules/tabs";
import { HarnessStack } from "./HarnessStack";

const mounts = vi.hoisted(() => ({
  harness: vi.fn(),
  native: vi.fn(),
  release: vi.fn(),
  removeSurface: vi.fn(),
  runtime: vi.fn(),
  stopRuntime: vi.fn(),
  requests: vi.fn(),
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/surfaces", () => ({
  removeHarnessSurface: mounts.removeSurface,
}));
vi.mock("./HarnessApp", () => ({
  HarnessRuntimeRoot: ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      mounts.runtime();
      return mounts.stopRuntime;
    }, []);
    return children;
  },
  HarnessApp: ({
    surfaceOwnerId,
    focused,
    projectRequest,
    onProjectRequestHandled,
  }: {
    surfaceOwnerId?: number;
    focused?: boolean;
    projectRequest?: { path: string };
    onProjectRequestHandled?: (request: { path: string }) => void;
  }) => {
    useEffect(() => {
      mounts.harness(surfaceOwnerId);
    }, [surfaceOwnerId]);
    useEffect(() => {
      if (focused && projectRequest) {
        mounts.requests(surfaceOwnerId, projectRequest.path);
        onProjectRequestHandled?.(projectRequest);
      }
    }, [focused, projectRequest, onProjectRequestHandled, surfaceOwnerId]);
    return createElement("div", { "data-harness": true }, "Harness");
  },
}));
vi.mock("./HarnessNativeAiView", () => ({
  HarnessNativeAiView: () => {
    useEffect(() => {
      mounts.native();
      return mounts.release;
    }, []);
    return createElement("div", { "data-native": true }, "Native AI");
  },
}));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tabs = [{ id: 1, kind: "harness", cwd: "/project" }] as HarnessTab[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("keeps Harness sessions mounted and releases native chat when the tab loses focus", async () => {
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs, activeId: 1 }));
  });
  expect(mounts.harness).toHaveBeenCalledTimes(1);
  const buttons = container.querySelectorAll<HTMLButtonElement>("button");
  await act(async () => {
    buttons[1].click();
  });
  expect(container.querySelector("[data-native]")).not.toBeNull();
  expect(container.querySelector("[data-harness]")).not.toBeNull();
  expect(mounts.harness).toHaveBeenCalledTimes(1);
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs, activeId: 2 }));
  });
  expect(container.querySelector("[data-native]")).toBeNull();
  expect(mounts.release).toHaveBeenCalledTimes(1);
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs, activeId: 1 }));
  });
  expect(mounts.native).toHaveBeenCalledTimes(2);
  await act(async () => {
    buttons[0].click();
  });
  expect(container.querySelector("[data-native]")).toBeNull();
  expect(mounts.harness).toHaveBeenCalledTimes(1);
});
it("keeps owner reports when hidden and removes only the unmounted owner", async () => {
  const otherTab = { id: 2, kind: "harness", cwd: "/other" } as HarnessTab;
  const bothTabs = [...tabs, otherTab];
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs: bothTabs, activeId: 1 }));
  });
  expect(mounts.harness).toHaveBeenCalledWith(1);
  expect(mounts.harness).toHaveBeenCalledWith(2);
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs: bothTabs, activeId: 2 }));
  });
  expect(mounts.harness).toHaveBeenCalledTimes(2);
  expect(mounts.removeSurface).not.toHaveBeenCalled();
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs: [otherTab], activeId: 2 }));
  });
  expect(mounts.removeSurface).toHaveBeenCalledTimes(1);
  expect(mounts.removeSurface).toHaveBeenCalledWith(1);
});

it("keeps one runtime alive after its final view closes and reopens", async () => {
  await act(async () =>
    root.render(createElement(HarnessStack, { tabs, activeId: 1 })),
  );
  expect(mounts.runtime).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(createElement(HarnessStack, { tabs: [], activeId: 0 })),
  );
  expect(mounts.stopRuntime).not.toHaveBeenCalled();
  await act(async () =>
    root.render(createElement(HarnessStack, { tabs, activeId: 1 })),
  );
  expect(mounts.runtime).toHaveBeenCalledOnce();
  expect(mounts.harness).toHaveBeenCalledTimes(2);
});

it("does not start the runtime for empty or cold-only tabs", async () => {
  await act(async () =>
    root.render(createElement(HarnessStack, { tabs: [], activeId: 0 })),
  );
  await act(async () =>
    root.render(
      createElement(HarnessStack, {
        tabs: [{ ...tabs[0], cold: true }],
        activeId: 1,
      }),
    ),
  );
  expect(mounts.runtime).not.toHaveBeenCalled();
  expect(mounts.harness).not.toHaveBeenCalled();
});

it("delivers project requests only after the selected outer view commits without replay", async () => {
  const both = [...tabs, { ...tabs[0], id: 2, cwd: "/other" }];
  await act(async () =>
    root.render(createElement(HarnessStack, { tabs: both, activeId: 1 })),
  );
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs: both, activeId: 2 }));
    window.dispatchEvent(
      new CustomEvent("voktty:harness-select-project", {
        detail: { path: "/target" },
      }),
    );
  });
  expect(mounts.requests).toHaveBeenCalledExactlyOnceWith(2, "/target");
  await act(async () =>
    root.render(createElement(HarnessStack, { tabs: both, activeId: 1 })),
  );
  expect(mounts.requests).toHaveBeenCalledOnce();
});
