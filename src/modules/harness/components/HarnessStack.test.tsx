// @vitest-environment happy-dom
import {
  act,
  createElement,
  useEffect,
  useLayoutEffect,
  useState,
  StrictMode,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessTab } from "@/modules/tabs";
import { HarnessStack } from "./HarnessStack";
import "@/modules/harness/components/HarnessRuntimeBootstrap";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import type {
  CreateHarnessNavigationView,
  HarnessNavigationView,
} from "@/modules/harness/lib/harnessWindowNavigation";
import { requestHarnessProject } from "@/modules/surfaces/lib/harnessProjectRequest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

const mounts = vi.hoisted(() => ({
  harness: vi.fn(),
  native: vi.fn(),
  release: vi.fn(),
  removeSurface: vi.fn(),
  runtime: vi.fn(),
  stopRuntime: vi.fn(),
  requests: vi.fn(),
  create: undefined as CreateHarnessNavigationView | undefined,
  registrations: vi.fn(),
  failedOwnerId: null as number | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  t: (key: string) => key,
}));
vi.mock("@/modules/surfaces", () => ({
  removeHarnessSurface: mounts.removeSurface,
}));
vi.mock("./HarnessApp", () => ({
  HarnessRuntimeRoot: ({
    children,
    createNavigationView,
  }: {
    children: ReactNode;
    createNavigationView?: CreateHarnessNavigationView;
  }) => {
    mounts.create = createNavigationView;
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
    onRegistered,
  }: {
    surfaceOwnerId?: number;
    focused?: boolean;
    projectRequest?: { path: string };
    onProjectRequestHandled?: (request: { path: string }) => void;
    onRegistered?: (view: HarnessNavigationView) => void;
  }) => {
    useLayoutEffect(() => {
      if (mounts.failedOwnerId === surfaceOwnerId)
        throw new Error("Harness reference is reserved");
      let current = true;
      const receipt = {
        ownerId: surfaceOwnerId ?? 1,
        isCurrent: () => current,
        release: () => {},
      };
      mounts.registrations(receipt);
      onRegistered?.(receipt);
      return () => {
        current = false;
      };
    }, [surfaceOwnerId, onRegistered]);
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
  mounts.create = undefined;
  mounts.failedOwnerId = null;
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

it("rejects a raw directed DOM event instead of changing its named view", async () => {
  const owned = { ...tabs[0], tabKey: asTabKey("tab-owned") };
  await act(async () => root.render(<HarnessStack tabs={[owned]} activeId={1} />));
  await act(async () => window.dispatchEvent(new CustomEvent("voktty:harness-select-project", {
    detail: { path: "/injected", target: { ownerId: 1, tabKey: "tab-owned" } },
  })));
  expect(mounts.requests).not.toHaveBeenCalled();
});

it("delivers a typed directed request without broadcasting a DOM event", async () => {
  const owned = { ...tabs[0], tabKey: asTabKey("tab-owned") };
  const legacy = vi.fn();
  window.addEventListener("voktty:harness-select-project", legacy);
  try {
    await act(async () => root.render(<HarnessStack tabs={[owned]} activeId={1} />));
    await act(async () => requestHarnessProject("/typed", { ownerId: 1, tabKey: owned.tabKey }));
    expect(mounts.requests).toHaveBeenCalledExactlyOnceWith(1, "/typed");
    expect(legacy).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("voktty:harness-select-project", legacy);
  }
});

it("creates a headless view and confirms its live registration under StrictMode", async () => {
  let close = () => {};
  const open = vi.fn(() => 7);
  function Window() {
    const [items, setItems] = useState(tabs);
    close = () => setItems([]);
    return (
      <HarnessStack
        tabs={items}
        activeId={items[0]?.id ?? 0}
        onCreateTab={() => {
          const id = open();
          setItems([{ ...tabs[0], id }]);
          return id;
        }}
      />
    );
  }
  await act(async () =>
    root.render(
      <StrictMode>
        <Window />
      </StrictMode>,
    ),
  );
  await act(async () => close());
  const create = mounts.create;
  const permit = createPersistenceAdmission().createOwner().capture();
  if (!create || !permit) throw new Error("Missing creator fixture");
  let pending: ReturnType<CreateHarnessNavigationView> | undefined;
  await act(async () => {
    pending = create("session", permit);
  });
  const receipt = await pending;
  expect(receipt?.ownerId).toBe(7);
  expect(receipt?.isCurrent()).toBe(true);
  expect(receipt).toBe(
    mounts.registrations.mock.calls[
      mounts.registrations.mock.calls.length - 1
    ]?.[0],
  );
  expect(open).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(receipt?.isCurrent()).toBe(false);
  expect(await create("later", permit)).toBeNull();
});

it("retains a directed request for its original view across a focus change", async () => {
  const both = [
    { ...tabs[0], tabKey: "tab-one" },
    { ...tabs[0], id: 2, tabKey: "tab-two" },
  ] as HarnessTab[];
  await act(async () => root.render(<HarnessStack tabs={both} activeId={1} />));
  await act(async () => {
    requestHarnessProject("remote://machine/project", { ownerId: 1, tabKey: asTabKey("tab-one") });
    root.render(<HarnessStack tabs={both} activeId={2} />);
  });
  expect(mounts.requests).not.toHaveBeenCalled();
  await act(async () => root.render(<HarnessStack tabs={both} activeId={1} />));
  expect(mounts.requests).toHaveBeenCalledExactlyOnceWith(1, "remote://machine/project");
});

it("never falls back to another view for malformed or retired directed targets", async () => {
  const original = { ...tabs[0], tabKey: "tab-original" } as HarnessTab;
  const replacement = { ...original, tabKey: "tab-replacement" } as HarnessTab;
  const other = { ...original, id: 2, tabKey: "tab-other" } as HarnessTab;
  await act(async () => root.render(<HarnessStack tabs={[original, other]} activeId={2} />));
  await act(async () => {
    requestHarnessProject("/retired", { ownerId: 1, tabKey: asTabKey("tab-original") });
    root.render(<HarnessStack tabs={[replacement, other]} activeId={1} />);
  });
  expect(mounts.requests).not.toHaveBeenCalled();
  await act(async () => root.render(<HarnessStack tabs={[original, other]} activeId={1} />));
  expect(mounts.requests).not.toHaveBeenCalled();
  await act(async () => {
    Reflect.apply(requestHarnessProject, undefined, ["/invalid", { ownerId: 2 }]);
  });
  expect(mounts.requests).not.toHaveBeenCalled();
});

it("delivers a directed request emitted before its cold destination commits", async () => {
  const cold = { ...tabs[0], id: 2, cold: true, tabKey: "tab-cold" } as HarnessTab;
  await act(async () => root.render(<HarnessStack tabs={[...tabs, cold]} activeId={1} />));
  await act(async () => {
    requestHarnessProject("C:/project", { ownerId: 2, tabKey: asTabKey("tab-cold") });
    root.render(<HarnessStack tabs={[...tabs, { ...cold, cold: false }]} activeId={2} />);
  });
  expect(mounts.requests).toHaveBeenCalledExactlyOnceWith(2, "C:/project");
});

it("accepts a newly created destination before its first outer render", async () => {
  const created = { ...tabs[0], id: 2, tabKey: "tab-created" } as HarnessTab;
  await act(async () => root.render(<HarnessStack tabs={tabs} activeId={1} />));
  await act(async () => {
    requestHarnessProject("/created-project", { ownerId: 2, tabKey: asTabKey("tab-created") });
    root.render(<HarnessStack tabs={[...tabs, created]} activeId={2} />);
  });
  expect(mounts.requests).toHaveBeenCalledExactlyOnceWith(2, "/created-project");
});

it("returns a directed destination from native chat to Harness before consuming the request", async () => {
  const destination = { ...tabs[0], tabKey: "tab-native" } as HarnessTab;
  await act(async () => root.render(<HarnessStack tabs={[destination]} activeId={1} />));
  await act(async () => container.querySelectorAll<HTMLButtonElement>("button")[1].click());
  expect(container.querySelector("[data-native]")).not.toBeNull();
  await act(async () => requestHarnessProject("/native-destination", { ownerId: 1, tabKey: asTabKey("tab-native") }));
  expect(container.querySelector("[data-native]")).toBeNull();
  expect(mounts.requests).toHaveBeenCalledExactlyOnceWith(1, "/native-destination");
});

it("isolates a rejected view registration without stopping the host or its sibling", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () =>
      root.render(<HarnessStack tabs={tabs} activeId={1} />),
    );
    mounts.failedOwnerId = 2;
    await act(async () =>
      root.render(
        <HarnessStack tabs={[...tabs, { ...tabs[0], id: 2 }]} activeId={2} />,
      ),
    );
    expect(mounts.runtime).toHaveBeenCalledOnce();
    expect(mounts.stopRuntime).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-harness]")).toHaveLength(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "feedback.tryAgain",
    );
    expect(container.textContent).not.toContain(
      "Harness reference is reserved",
    );
    mounts.failedOwnerId = null;
    const retry = container.querySelector<HTMLButtonElement>(
      "[role=alert] button",
    );
    if (!retry) throw new Error("Missing view retry");
    await act(async () => retry.click());
    expect(container.querySelectorAll("[data-harness]")).toHaveLength(2);
    expect(mounts.runtime).toHaveBeenCalledOnce();
    expect(mounts.stopRuntime).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
