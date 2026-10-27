// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  HarnessProjectOwner,
  useHarnessProjectSelection,
} from "@/modules/harness/hooks/useHarnessProjectSelection";
import {
  subscribeHarnessProjectRequests,
  type HarnessProjectTarget,
} from "@/modules/surfaces/lib/harnessProjectRequest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

const one = { ownerId: 1, tabKey: asTabKey("tab-one") };
const two = { ownerId: 2, tabKey: asTabKey("tab-two") };
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing project selection fixture");
  return value;
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllGlobals();
});

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  const root = createRoot(element);
  cleanups.push(async () => {
    await act(async () => root.unmount());
  });
  const selected = vi.fn();
  cleanups.push(subscribeHarnessProjectRequests(selected));
  let capture!: ReturnType<typeof useHarnessProjectSelection>;
  function View({ cwd }: { cwd: string }) {
    capture = useHarnessProjectSelection(cwd);
    return null;
  }
  const render = async (
    owner: HarnessProjectTarget | null = one,
    cwd = "/project",
  ) => {
    await act(async () =>
      root.render(
        <StrictMode>
          <HarnessProjectOwner value={owner}>
            <View cwd={cwd} />
          </HarnessProjectOwner>
        </StrictMode>,
      ),
    );
  };
  await render();
  return {
    render,
    selected,
    capture: () => capture(),
    unmount: async () => {
      await act(async () => root.render(null));
    },
  };
}

it("retains the exact destination through unrelated renders and consumes a selection once", async () => {
  const f = await setup();
  const request = required(f.capture());
  await f.render({ ...one });
  request.select("remote://machine/root");
  request.select("/duplicate");
  expect(f.selected).toHaveBeenCalledExactlyOnceWith({
    path: "remote://machine/root",
    target: one,
  });
  expect(request.isCurrent()).toBe(false);
});

it.each([two, { ...one, tabKey: asTabKey("tab-replaced") }, null])(
  "retires the original view without adopting its successor (%j)",
  async (successor) => {
    const f = await setup();
    const request = required(f.capture());
    await f.render(successor);
    await f.render(one);
    expect(request.isCurrent()).toBe(false);
    request.select("/late");
    expect(f.selected).not.toHaveBeenCalled();
  },
);

it("retires a project change even when the view later returns to the same path", async () => {
  const f = await setup();
  const request = required(f.capture());
  await f.render(one, "/other");
  await f.render();
  request.select("/late");
  expect(f.selected).not.toHaveBeenCalled();
});

it("keeps cancellation independent from another request in the same view", async () => {
  const f = await setup();
  const old = required(f.capture());
  const current = required(f.capture());
  old.retire();
  old.select("/cancelled");
  current.select("//server/share/project");
  expect(f.selected).toHaveBeenCalledExactlyOnceWith({
    path: "//server/share/project",
    target: one,
  });
});

it("retires on unmount and cannot capture without an owning view", async () => {
  const f = await setup();
  const request = required(f.capture());
  await f.unmount();
  request.select("/late");
  await f.render(null);
  expect(f.capture()).toBeNull();
  expect(f.selected).not.toHaveBeenCalled();
});
