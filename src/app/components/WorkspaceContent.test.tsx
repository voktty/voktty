// @vitest-environment happy-dom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceContent } from "@/app/components/WorkspaceContent";
import { HarnessStack } from "@/modules/harness/components/HarnessStack";
import type { HarnessTab } from "@/modules/tabs";

const runtime = vi.hoisted(() => ({ mount: vi.fn(), stop: vi.fn() }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/surfaces", () => ({ removeHarnessSurface: vi.fn() }));
vi.mock("@/modules/harness/components/HarnessApp", () => ({
  HarnessRuntimeRoot: ({ children }: { children: ReactNode }) => {
    const [identity] = useState(() => ({}));
    useEffect(() => {
      runtime.mount(identity);
      return () => runtime.stop(identity);
    }, [identity]);
    return children;
  },
  HarnessApp: () => <span data-harness-view />,
}));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const tab = { id: 1, kind: "harness", cwd: "/project" } as HarnessTab;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(tabs: HarnessTab[], overlay: ReactNode) {
  await act(async () =>
    root.render(
      <WorkspaceContent overlay={overlay}>
        <HarnessStack tabs={tabs} activeId={tabs[0]?.id ?? 0} />
      </WorkspaceContent>,
    ),
  );
}

it("retains the exact activated runtime while the selected space and all tabs become empty", async () => {
  await render([tab], null);
  const identity = runtime.mount.mock.calls[0]?.[0];
  expect(identity).toBeDefined();
  await render([tab], <button type="button">Another space is empty</button>);
  expect(runtime.stop).not.toHaveBeenCalled();
  expect(container.querySelector("[data-harness-view]")).not.toBeNull();
  await render([], <button type="button">Empty workspace</button>);
  expect(runtime.stop).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.textContent).toBe(
    "Empty workspace",
  );
  expect(container.firstElementChild?.hasAttribute("hidden")).toBe(true);
  expect(container.querySelector("[data-harness-view]")).toBeNull();
  await render([], <button type="button">Retry boot</button>);
  expect(runtime.stop).not.toHaveBeenCalled();
  await render([tab], null);
  expect(runtime.mount).toHaveBeenCalledExactlyOnceWith(identity);
  expect(container.firstElementChild?.hasAttribute("hidden")).toBe(false);
  expect(container.textContent).not.toContain("Retry boot");
  expect(container.querySelector("[data-harness-view]")).not.toBeNull();
  await act(async () => root.render(null));
  expect(runtime.stop).toHaveBeenCalledExactlyOnceWith(identity);
});

it("does not activate a runtime while only empty or cold workspaces exist", async () => {
  await render([], <button type="button">Empty workspace</button>);
  await render([{ ...tab, cold: true }], null);
  await render([], <button type="button">Retry boot</button>);
  expect(runtime.mount).not.toHaveBeenCalled();
});
