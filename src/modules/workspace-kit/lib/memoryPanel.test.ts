import { expect, it, vi } from "vitest";
import {
  createMemoryPanelController,
  supportedMemoryPanelTarget,
  type MemoryPanelState,
  type MemoryPanelTarget,
} from "@/modules/workspace-kit/lib/memoryPanel";
import type {
  NativeMemoryScope,
  NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";

const target: MemoryPanelTarget = {
  path: "/project",
  environment: { kind: "local" },
  source: "terminal:one",
};
const selected = {} as NativeMemorySelection;
const observation = { schema: 1, root: "/project" } as NativeMemoryScope;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function client() {
  return {
    select: vi.fn(async () => selected),
    isCurrent: vi.fn(() => true),
    discover: vi.fn(async () => observation),
    initializeLocalState: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    preview: vi.fn(),
    confirmPreview: vi.fn(),
    cancelPreview: vi.fn(),
    isReviewCurrent: vi.fn(() => true),
    reviewTrust: vi.fn(),
    confirmTrust: vi.fn(),
    cancelTrust: vi.fn(),
    isTrustReviewCurrent: vi.fn(() => true),
    reviewPolicy: vi.fn(),
    confirmPolicy: vi.fn(),
    cancelPolicy: vi.fn(),
    isPolicyReviewCurrent: vi.fn(() => true),
  };
}

it("starts no work on creation, coalesces reads, and prepares only on explicit action", async () => {
  const api = client();
  const states: MemoryPanelState[] = [];
  const panel = createMemoryPanelController(
    target,
    (state) => states.push(state),
    () => api,
  );
  expect(api.select).not.toHaveBeenCalled();
  const load = panel.load();
  expect(panel.load()).toBe(load);
  await load;
  expect(api.initializeLocalState).not.toHaveBeenCalled();
  expect(api.discover).toHaveBeenCalledWith(selected);
  expect(states[states.length - 1]).toEqual({ status: "ready", observation });
  await panel.prepare();
  expect(api.initializeLocalState).toHaveBeenCalledOnce();
  expect(api.select).toHaveBeenCalledOnce();
  await panel.dispose();
});

it("withdraws authority before a loading callback can request a write", async () => {
  const api = client();
  let panel: ReturnType<typeof createMemoryPanelController>;
  panel = createMemoryPanelController(
    target,
    () => {
      void panel.dispose();
    },
    () => api,
  );
  await panel.prepare();
  expect(api.select).not.toHaveBeenCalled();
  expect(api.initializeLocalState).not.toHaveBeenCalled();
  await panel.dispose();
});

it("cannot publish a read after closing and does not prepare from a stale selection", async () => {
  const api = client();
  const read = deferred<NativeMemoryScope>();
  const started = deferred<void>();
  api.discover.mockImplementation(() => {
    started.resolve();
    return read.promise;
  });
  const publish = vi.fn();
  const panel = createMemoryPanelController(target, publish, () => api);
  const load = panel.load();
  await started.promise;
  await panel.dispose();
  read.resolve(observation);
  await load;
  await panel.prepare();
  expect(publish.mock.calls.map(([state]) => state.status)).toEqual([
    "loading",
  ]);
  expect(api.initializeLocalState).not.toHaveBeenCalled();
});

it("requires a retained selected source before offering private-state preparation", async () => {
  const api = client();
  const publish = vi.fn();
  api.discover.mockRejectedValueOnce({ code: "missingState" });
  const panel = createMemoryPanelController(target, publish, () => api);
  await panel.load();
  expect(publish).toHaveBeenLastCalledWith({
    status: "error",
    code: "missingState",
    canPrepare: true,
  });
  api.isCurrent.mockReturnValue(false);
  await panel.prepare();
  expect(api.initializeLocalState).not.toHaveBeenCalled();
  await panel.dispose();
});

it("retains failed cleanup in the shared capacity until its actual acknowledgement", async () => {
  let fail = true;
  const api = client();
  api.close.mockImplementation(async () => {
    if (fail) throw new Error("fixture close");
  });
  const panels = Array.from({ length: 256 }, () =>
    createMemoryPanelController(
      target,
      () => {},
      () => api,
    ),
  );
  await Promise.all(panels.map((panel) => panel.dispose()));
  expect(() =>
    createMemoryPanelController(
      target,
      () => {},
      () => api,
    ),
  ).toThrow();
  fail = false;
  await Promise.all(panels.map((panel) => panel.dispose()));
  const replacement = createMemoryPanelController(
    target,
    () => {},
    () => api,
  );
  await replacement.dispose();
});

it("rejects remote namespaces and nonlocal environments without reinterpreting paths", () => {
  expect(supportedMemoryPanelTarget(target)).toBe(true);
  for (const unsupported of [
    { ...target, path: "remote://host/project" },
    { ...target, path: "bad\npath" },
    { ...target, path: "" },
    { ...target, environment: { kind: "wsl" as const, distro: "ubuntu" } },
  ])
    expect(supportedMemoryPanelTarget(unsupported)).toBe(false);
});

it("recovers denied selection only after explicit directory authorization and retains its canonical target", async () => {
  const api = client();
  api.select.mockRejectedValueOnce({ code: "denied" });
  const authorize = vi.fn(async () => "/canonical/project");
  const publish = vi.fn();
  const panel = createMemoryPanelController(target, publish, () => api, authorize);
  await panel.authorize();
  await panel.load();
  expect(authorize).not.toHaveBeenCalled();
  expect(publish).toHaveBeenLastCalledWith({ status: "error", code: "denied", canPrepare: false });
  await Promise.all([panel.authorize(), panel.authorize()]);
  expect(authorize).toHaveBeenCalledExactlyOnceWith("/project");
  expect(api.select).toHaveBeenLastCalledWith("/canonical/project", { kind: "local" });
  expect(publish).toHaveBeenLastCalledWith({ status: "ready", observation });
  expect(api.initializeLocalState).not.toHaveBeenCalled();
  expect(api.confirmTrust).not.toHaveBeenCalled();
  expect(api.confirmPolicy).not.toHaveBeenCalled();
  expect(api.confirmPreview).not.toHaveBeenCalled();
  await panel.dispose();
});

it("never selects or publishes a directory after its authorization owner retires", async () => {
  const api = client();
  api.select.mockRejectedValueOnce({ code: "denied" });
  const result = deferred<string>();
  const started = deferred<void>();
  const authorize = vi.fn(() => { started.resolve(); return result.promise; });
  const publish = vi.fn();
  const panel = createMemoryPanelController(target, publish, () => api, authorize);
  await panel.load();
  const pending = panel.authorize();
  await started.promise;
  await panel.dispose();
  result.resolve("/canonical/project");
  await pending;
  expect(api.select).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenLastCalledWith({ status: "loading" });
});

it("redacts unknown error codes and never offers authorization for an unsupported target", async () => {
  const api = client();
  const publish = vi.fn();
  const authorize = vi.fn();
  api.select.mockRejectedValueOnce({ code: "private error details" });
  const panel = createMemoryPanelController(target, publish, () => api, authorize);
  await panel.load();
  expect(publish).toHaveBeenLastCalledWith({ status: "error", code: "unavailable", canPrepare: false });
  await panel.authorize();
  expect(authorize).not.toHaveBeenCalled();
  await panel.dispose();
  api.select.mockRejectedValueOnce({ code: "denied" });
  const remote = createMemoryPanelController({ ...target, environment: { kind: "wsl", distro: "owned" } }, publish, () => api, authorize);
  await remote.load();
  await remote.authorize();
  expect(authorize).not.toHaveBeenCalled();
  await remote.dispose();
});
