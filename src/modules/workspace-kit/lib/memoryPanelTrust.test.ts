import { expect, it, vi } from "vitest";
import {
  createMemoryPanelController,
  canReviewMemoryTrust,
  type MemoryPanelState,
} from "@/modules/workspace-kit/lib/memoryPanel";
import type {
  NativeMemoryScope,
  NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type { NativeMemoryTrustReview } from "@/modules/workspace-kit/lib/nativeMemoryTrust";
import {
  trustReply,
  trustAccepted,
} from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const selected = {} as NativeMemorySelection;
const observation = {
  schema: 1,
  root: "/canonical/project",
  blockedCount: 0,
  scope: { state: "ready", ancestryComplete: true },
} as NativeMemoryScope;
const reviewed = {
  snapshot: trustReply(),
} as unknown as NativeMemoryTrustReview;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const api = {
    select: vi.fn(async () => selected),
    isCurrent: vi.fn(() => true),
    discover: vi.fn(async () => observation),
    initializeLocalState: vi.fn(),
    close: vi.fn(async () => {}),
    preview: vi.fn(),
    confirmPreview: vi.fn(),
    cancelPreview: vi.fn(),
    isReviewCurrent: vi.fn(() => true),
    reviewTrust: vi.fn(async () => reviewed),
    confirmTrust: vi.fn(async () => trustAccepted),
    cancelTrust: vi.fn(async () => true),
    isTrustReviewCurrent: vi.fn(() => true),
    reviewPolicy: vi.fn(),
    confirmPolicy: vi.fn(),
    cancelPolicy: vi.fn(),
    isPolicyReviewCurrent: vi.fn(() => true),
  };
  const states: MemoryPanelState[] = [];
  const publish = vi.fn((state: MemoryPanelState) => {
    states.push(state);
  });
  const panel = createMemoryPanelController(
    {
      path: "/project/src",
      environment: { kind: "local" },
      source: "harness:one",
    },
    publish,
    () => api,
  );
  return { api, states, publish, panel };
}
it("reads instructions only on explicit review and confirms only the exact current object once", async () => {
  const f = fixture();
  await f.panel.load();
  expect(f.api.reviewTrust).not.toHaveBeenCalled();
  await f.panel.reviewTrust();
  expect(f.api.reviewTrust).toHaveBeenCalledWith(selected);
  expect(f.api.confirmTrust).not.toHaveBeenCalled();
  await f.panel.confirmTrust({ ...reviewed });
  expect(f.api.confirmTrust).not.toHaveBeenCalled();
  const confirm = f.panel.confirmTrust(reviewed);
  expect(f.panel.confirmTrust(reviewed)).toBe(confirm);
  await confirm;
  await f.panel.confirmTrust(reviewed);
  expect(f.api.confirmTrust).toHaveBeenCalledOnce();
  expect(f.states[f.states.length - 1]).toEqual({
    status: "trustAccepted",
    root: "/canonical/project",
    report: trustAccepted,
  });
  expect(f.api.initializeLocalState).not.toHaveBeenCalled();
  await f.panel.dispose();
});
it("blocks instruction review for ambiguous, incomplete, unavailable or unrooted observations", async () => {
  expect(canReviewMemoryTrust(observation)).toBe(true);
  for (const invalid of [
    { ...observation, root: null },
    { ...observation, blockedCount: 1 },
    {
      ...observation,
      scope: { ...observation.scope, ancestryComplete: false },
    },
    ...(
      ["absent", "reserved", "ambiguous", "incomplete", "invalid"] as const
    ).map((state) => ({
      ...observation,
      scope: { ...observation.scope, state },
    })),
  ]) {
    const f = fixture();
    f.api.discover.mockResolvedValue(invalid);
    await f.panel.load();
    await f.panel.reviewTrust();
    expect(f.api.reviewTrust).not.toHaveBeenCalled();
    await f.panel.dispose();
  }
});
it("withdraws trust reads and writes when a synchronous observer disposes the panel", async () => {
  for (const phase of ["trustLoading", "trustAccepting"] as const) {
    const f = fixture();
    await f.panel.load();
    if (phase === "trustAccepting") await f.panel.reviewTrust();
    f.publish.mockImplementation((state) => {
      if (state.status === phase) void f.panel.dispose();
    });
    if (phase === "trustAccepting") await f.panel.confirmTrust(reviewed);
    else await f.panel.reviewTrust();
    expect(f.api.confirmTrust).not.toHaveBeenCalled();
    if (phase === "trustLoading")
      expect(f.api.reviewTrust).not.toHaveBeenCalled();
    await f.panel.dispose();
  }
});
it("suppresses late trust data after disposal and waits for cancellation before returning", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.reviewTrust();
  const cancel = deferred<boolean>();
  const started = deferred<void>();
  f.api.cancelTrust.mockImplementation(() => {
    started.resolve();
    return cancel.promise;
  });
  const back = f.panel.backTrust();
  await started.promise;
  expect(f.states[f.states.length - 1]?.status).toBe("trustLoading");
  await f.panel.dispose();
  const count = f.publish.mock.calls.length;
  cancel.resolve(true);
  await back;
  expect(f.publish).toHaveBeenCalledTimes(count);
  expect(f.api.confirmTrust).not.toHaveBeenCalled();
});
it("does not retry failed acceptance or reuse a review after going back", async () => {
  const f = fixture();
  await f.panel.load();
  await f.panel.reviewTrust();
  f.api.confirmTrust.mockRejectedValueOnce({ code: "stale" });
  await f.panel.confirmTrust(reviewed);
  expect(f.states[f.states.length - 1]).toEqual({
    status: "trustError",
    code: "stale",
  });
  await f.panel.confirmTrust(reviewed);
  expect(f.api.confirmTrust).toHaveBeenCalledOnce();
  await f.panel.backTrust();
  expect(f.api.cancelTrust).toHaveBeenCalledWith(selected);
  expect(f.states[f.states.length - 1]).toEqual({
    status: "ready",
    observation,
  });
  await f.panel.confirmTrust(reviewed);
  expect(f.api.confirmTrust).toHaveBeenCalledOnce();
  await f.panel.dispose();
});

it("does not publish an instruction read that settles after its panel closes", async () => {
  const f = fixture();
  await f.panel.load();
  const started = deferred<void>();
  const read = deferred<NativeMemoryTrustReview>();
  f.api.reviewTrust.mockImplementation(() => {
    started.resolve();
    return read.promise;
  });
  const pending = f.panel.reviewTrust();
  await started.promise;
  await f.panel.dispose();
  const count = f.publish.mock.calls.length;
  read.resolve(reviewed);
  await pending;
  expect(f.publish).toHaveBeenCalledTimes(count);
  await f.panel.confirmTrust(reviewed);
  expect(f.api.confirmTrust).not.toHaveBeenCalled();
});
