// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEndpointProbe } from "./useEndpointProbe";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let probe: ReturnType<typeof useEndpointProbe>;
function View({ url }: { url: string }) {
  probe = useEndpointProbe(url);
  return createElement("span", null, `${probe.status} ${probe.detail ?? ""}`);
}
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
  invoke.mockReset();
  vi.unstubAllGlobals();
});

it("discards a late successful probe when the endpoint URL changes", async () => {
  let finish!: (status: number) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    root.render(createElement(View, { url: "http://old.local/v1" }));
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = probe.test();
  });
  expect(probe.status).toBe("testing");
  await act(async () => {
    root.render(createElement(View, { url: "http://new.local/v1" }));
  });
  expect(probe.status).toBe("idle");
  await act(async () => {
    finish(200);
    await pending;
  });
  expect(probe.status).toBe("idle");
  invoke.mockResolvedValueOnce(200);
  await act(async () => {
    await probe.test();
  });
  expect(probe.status).toBe("ok");
});

it("shows a bounded safe failure detail and never marks a failing server connected", async () => {
  invoke.mockRejectedValueOnce(
    new Error("dns: http://server.local/v1?token=private not found"),
  );
  await act(async () => {
    root.render(createElement(View, { url: "http://server.local/v1" }));
  });
  await act(async () => {
    await probe.test();
  });
  expect(probe.status).toBe("fail");
  expect(probe.detail).toBe("dns: <endpoint> not found");
});
