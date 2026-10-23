// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHarnessViewActivation } from "@/modules/harness/hooks/useHarnessViewActivation";

let root: Root;
let container: HTMLDivElement;
let activate: () => Promise<boolean>;
function View({ ready, request }: { ready: boolean; request: () => void }) {
  activate = useHarnessViewActivation(ready, request);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("confirms only committed focus and mode, not request acceptance", async () => {
  const request = vi.fn();
  await act(async () => root.render(<View ready={false} request={request} />));
  let settled = false;
  const pending = activate();
  void pending.then(() => {
    settled = true;
  });
  await act(async () => {});
  expect(request).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  await act(async () => root.render(<View ready request={request} />));
  expect(await pending).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("retires pending and cached activation on unmount", async () => {
  const request = vi.fn();
  await act(async () => root.render(<View ready={false} request={request} />));
  const cached = activate;
  const pending = cached();
  await act(async () => root.render(null));
  expect(await pending).toBe(false);
  expect(await cached()).toBe(false);
  expect(request).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds unsettled activations and clears every timer when retired", async () => {
  const request = vi.fn();
  await act(async () => root.render(<View ready={false} request={request} />));
  const pending = Array.from({ length: 256 }, () => activate());
  expect(await activate()).toBe(false);
  expect(request).toHaveBeenCalledTimes(256);
  await act(async () => root.render(null));
  expect((await Promise.all(pending)).every((confirmed) => !confirmed)).toBe(
    true,
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("reports timeout and request failure without leaving pending timers", async () => {
  await act(async () => root.render(<View ready={false} request={() => {}} />));
  const pending = activate();
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(await pending).toBe(false);
  await act(async () =>
    root.render(
      <View
        ready={false}
        request={() => {
          throw new Error("Rejected");
        }}
      />,
    ),
  );
  expect(await activate()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
