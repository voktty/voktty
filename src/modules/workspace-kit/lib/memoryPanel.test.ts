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
