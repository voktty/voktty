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
    inspect: vi.fn(async () => observation),
    documents: vi.fn(),
    initializeLocalState: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    preview: vi.fn(),
    confirmPreview: vi.fn(),
    cancelPreview: vi.fn(),
    isReviewCurrent: vi.fn(() => true),
    reviewRecovery: vi.fn(),
    confirmRecovery: vi.fn(),
    cancelRecovery: vi.fn(),
    isRecoveryReviewCurrent: vi.fn(() => true),
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

it("reads display documents only by action and never changes trust, policy or state", async () => {
  const api = client();
  const ready = {
    ...observation,
    blockedCount: 0,
    scope: { state: "ready", ancestryComplete: true },
  } as NativeMemoryScope;
  api.inspect.mockResolvedValue(ready);
  const snapshot = {
    schema: 1,
    root: "/project",
    complete: true,
    blockedCount: 0,
    files: [],
  };
  api.documents.mockResolvedValue(snapshot);
  const publish = vi.fn();
  const panel = createMemoryPanelController(target, publish, () => api);
  await panel.browseDocuments();
  await panel.load();
  expect(api.documents).not.toHaveBeenCalled();
  await Promise.all([panel.browseDocuments(), panel.browseDocuments()]);
  expect(api.documents).toHaveBeenCalledExactlyOnceWith(selected, "/project");
  expect(publish).toHaveBeenLastCalledWith({
    status: "documentsReady",
    snapshot,
  });
  panel.backDocuments();
  expect(publish).toHaveBeenLastCalledWith({
    status: "ready",
    observation: ready,
  });
  for (const method of [
    api.initializeLocalState,
    api.reviewTrust,
    api.confirmTrust,
    api.reviewPolicy,
    api.confirmPolicy,
    api.preview,
  ])
    expect(method).not.toHaveBeenCalled();
  await panel.dispose();
});

it("withdraws document admission if a loading observer retires its panel", async () => {
  const api = client();
  api.inspect.mockResolvedValue({
    ...observation,
    blockedCount: 0,
    scope: { state: "ready", ancestryComplete: true },
  } as NativeMemoryScope);
  let panel: ReturnType<typeof createMemoryPanelController>;
  panel = createMemoryPanelController(
    target,
    (state) => {
      if (state.status === "documentsLoading") void panel.dispose();
    },
    () => api,
  );
  await panel.load();
  await panel.browseDocuments();
  expect(api.documents).not.toHaveBeenCalled();
  await panel.dispose();
});

it("starts no work on creation, coalesces reads and never prepares private settings", async () => {
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
  expect(api.select).toHaveBeenCalledExactlyOnceWith(
    "/project",
    { kind: "local" },
    { inspectAncestors: true },
  );
  expect(api.initializeLocalState).not.toHaveBeenCalled();
  expect(api.inspect).toHaveBeenCalledWith(selected);
  expect(api.discover).not.toHaveBeenCalled();
  expect(states[states.length - 1]).toEqual({ status: "ready", observation });
  await panel.load();
  expect(api.initializeLocalState).not.toHaveBeenCalled();
  expect(api.inspect).toHaveBeenCalledTimes(2);
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
  await panel.load();
  expect(api.select).not.toHaveBeenCalled();
  expect(api.initializeLocalState).not.toHaveBeenCalled();
  await panel.dispose();
});

it("cannot publish a read after closing and does not prepare from a stale selection", async () => {
  const api = client();
  const read = deferred<NativeMemoryScope>();
  const started = deferred<void>();
  api.inspect.mockImplementation(() => {
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
  await panel.load();
  expect(publish.mock.calls.map(([state]) => state.status)).toEqual([
    "loading",
  ]);
  expect(api.initializeLocalState).not.toHaveBeenCalled();
});

it("reports inspection failures without preparing private state", async () => {
  const api = client();
  const publish = vi.fn();
  api.inspect.mockRejectedValueOnce({ code: "missingState" });
  const panel = createMemoryPanelController(target, publish, () => api);
  await panel.load();
  expect(publish).toHaveBeenLastCalledWith({
    status: "error",
    code: "missingState",
  });
  api.isCurrent.mockReturnValue(false);
  await panel.load();
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

it("admits SSH routing while rejecting malformed paths and unsupported transports", () => {
  expect(supportedMemoryPanelTarget(target)).toBe(true);
  expect(
    supportedMemoryPanelTarget({ ...target, path: "remote://host/project" }),
  ).toBe(true);
  expect(
    supportedMemoryPanelTarget({
      ...target,
      environment: {
        kind: "ssh",
        root: "/project",
        connection: { id: "ssh", name: "SSH", host: "host" },
      },
    }),
  ).toBe(true);
  for (const unsupported of [
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
  const panel = createMemoryPanelController(
    target,
    publish,
    () => api,
    authorize,
  );
  await panel.authorize();
  await panel.load();
  expect(authorize).not.toHaveBeenCalled();
  expect(publish).toHaveBeenLastCalledWith({
    status: "error",
    code: "denied",
  });
  await Promise.all([panel.authorize(), panel.authorize()]);
  expect(authorize).toHaveBeenCalledExactlyOnceWith("/project");
  expect(api.select).toHaveBeenLastCalledWith(
    "/canonical/project",
    { kind: "local" },
    { inspectAncestors: true },
  );
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
  const authorize = vi.fn(() => {
    started.resolve();
    return result.promise;
  });
  const publish = vi.fn();
  const panel = createMemoryPanelController(
    target,
    publish,
    () => api,
    authorize,
  );
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
  const panel = createMemoryPanelController(
    target,
    publish,
    () => api,
    authorize,
  );
  await panel.load();
  expect(publish).toHaveBeenLastCalledWith({
    status: "error",
    code: "unavailable",
  });
  await panel.authorize();
  expect(authorize).not.toHaveBeenCalled();
  await panel.dispose();
  api.select.mockRejectedValueOnce({ code: "denied" });
  const remote = createMemoryPanelController(
    { ...target, environment: { kind: "wsl", distro: "owned" } },
    publish,
    () => api,
    authorize,
  );
  await remote.load();
  await remote.authorize();
  expect(authorize).not.toHaveBeenCalled();
  await remote.dispose();
});
