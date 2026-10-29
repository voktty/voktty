import { expect, it, vi } from "vitest";
import {
  canReviewMemoryPolicy,
  createMemoryPanelController,
  type MemoryPanelState,
} from "@/modules/workspace-kit/lib/memoryPanel";
import type {
  NativeMemorySelection,
  NativeMemoryScope,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type { NativeMemoryPolicyReview } from "@/modules/workspace-kit/lib/nativeMemoryPolicy";

const selected = {} as NativeMemorySelection;
const observation = {
  schema: 1,
  root: "/canonical/project",
  blockedCount: 0,
  scope: { state: "ready", ancestryComplete: true },
} as NativeMemoryScope;
const reviewed = {
  snapshot: {
    schema: 1,
    root: "/canonical/project",
    projectKey: "a".repeat(64),
    policy: "always",
    preference: null,
  },
} as unknown as NativeMemoryPolicyReview;
const report = {
  schema: 1 as const,
  preference: {
    projectKey: "a".repeat(64),
    policy: "always" as const,
    instructionDigest: null,
  },
};
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
    reviewTrust: vi.fn(),
    confirmTrust: vi.fn(),
    cancelTrust: vi.fn(),
    isTrustReviewCurrent: vi.fn(() => true),
    reviewPolicy: vi.fn(async () => reviewed),
    confirmPolicy: vi.fn(async () => report),
    cancelPolicy: vi.fn(async () => true),
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
      source: "terminal:one",
    },
    publish,
    () => api,
  );
  return { api, states, publish, panel };
}

it("does no policy IO on creation, metadata load or configuration, and back changes nothing", async () => {
  const f = fixture();
  await f.panel.reviewPolicy("always");
  await f.panel.load();
  f.panel.configurePolicy();
  expect(f.states[f.states.length - 1]).toEqual({
    status: "policyConfiguring",
  });
  expect(f.api.reviewPolicy).not.toHaveBeenCalled();
  await f.panel.backPolicy();
  expect(f.states[f.states.length - 1]).toEqual({
    status: "ready",
    observation,
  });
  expect(f.api.confirmPolicy).not.toHaveBeenCalled();
  expect(f.api.cancelPolicy).not.toHaveBeenCalled();
  expect(f.api.initializeLocalState).not.toHaveBeenCalled();
  expect(f.api.reviewTrust).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it.each(["manual", "always", "never"] as const)(
  "reviews the explicit %s choice before permitting a single exact confirmation",
  async (choice) => {
    const f = fixture();
    await f.panel.load();
    f.panel.configurePolicy();
    const reading = f.panel.reviewPolicy(choice);
    expect(f.panel.reviewPolicy(choice)).toBe(reading);
    await reading;
    expect(f.api.reviewPolicy).toHaveBeenCalledWith(selected, choice);
    expect(f.api.confirmPolicy).not.toHaveBeenCalled();
    await f.panel.confirmPolicy({ ...reviewed });
    expect(f.api.confirmPolicy).not.toHaveBeenCalled();
    const confirming = f.panel.confirmPolicy(reviewed);
    expect(f.panel.confirmPolicy(reviewed)).toBe(confirming);
    await confirming;
    await f.panel.confirmPolicy(reviewed);
    expect(f.api.confirmPolicy).toHaveBeenCalledExactlyOnceWith(
      selected,
      reviewed,
    );
    expect(f.states[f.states.length - 1]).toEqual({
      status: "policyAccepted",
      root: "/canonical/project",
      report,
    });
    await f.panel.backPolicy();
    expect(f.states[f.states.length - 1]).toEqual({
      status: "ready",
      observation,
    });
    expect(f.api.initializeLocalState).not.toHaveBeenCalled();
    expect(f.api.confirmTrust).not.toHaveBeenCalled();
    await f.panel.dispose();
  },
);

it("requires complete, unambiguous native memory before offering policy choices", async () => {
  expect(canReviewMemoryPolicy(observation)).toBe(true);
  for (const invalid of [
    { ...observation, root: null },
    { ...observation, blockedCount: 1 },
    {
      ...observation,
      scope: { ...observation.scope, ancestryComplete: false },
    },
    ...(
      [
        "absent",
        "reserved",
        "ambiguous",
        "incomplete",
        "invalid",
        "partial",
        "denied",
      ] as const
    ).map((state) => ({
      ...observation,
      scope: { ...observation.scope, state },
    })),
  ]) {
    const f = fixture();
    f.api.discover.mockResolvedValue(invalid);
    await f.panel.load();
    f.panel.configurePolicy();
    await f.panel.reviewPolicy("always");
    expect(f.states[f.states.length - 1]?.status).toBe("ready");
    expect(f.api.reviewPolicy).not.toHaveBeenCalled();
    expect(f.api.confirmPolicy).not.toHaveBeenCalled();
    await f.panel.dispose();
  }
});

it.each(["policyLoading", "policyAccepting"] as const)(
  "rechecks authority after a %s observer disposes the original panel",
  async (phase) => {
    const f = fixture();
    await f.panel.load();
    f.panel.configurePolicy();
    if (phase === "policyAccepting") await f.panel.reviewPolicy("always");
    f.publish.mockImplementation((state) => {
      if (state.status === phase) void f.panel.dispose();
    });
    if (phase === "policyAccepting") await f.panel.confirmPolicy(reviewed);
    else await f.panel.reviewPolicy("always");
    expect(f.api.confirmPolicy).not.toHaveBeenCalled();
    if (phase === "policyLoading")
      expect(f.api.reviewPolicy).not.toHaveBeenCalled();
    await f.panel.dispose();
  },
);

it("does not write when a publication observer retires just the reviewed native receipt", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configurePolicy();
  await f.panel.reviewPolicy("always");
  f.publish.mockImplementation((state) => {
    if (state.status === "policyAccepting")
      f.api.isPolicyReviewCurrent.mockReturnValue(false);
  });
  await f.panel.confirmPolicy(reviewed);
  expect(f.api.confirmPolicy).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it("does not publish a policy review that finishes after source retirement", async () => {
  const f = fixture();
  const read = deferred<NativeMemoryPolicyReview>();
  const started = deferred<void>();
  f.api.reviewPolicy.mockImplementation(() => {
    started.resolve();
    return read.promise;
  });
  await f.panel.load();
  f.panel.configurePolicy();
  const pending = f.panel.reviewPolicy("always");
  await started.promise;
  f.api.isCurrent.mockReturnValue(false);
  const count = f.publish.mock.calls.length;
  read.resolve(reviewed);
  await pending;
  expect(f.publish).toHaveBeenCalledTimes(count);
  await f.panel.confirmPolicy(reviewed);
  expect(f.api.confirmPolicy).not.toHaveBeenCalled();
  await f.panel.dispose();
});

it("waits for original cancellation before returning to choices and suppresses late cleanup", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configurePolicy();
  await f.panel.reviewPolicy("always");
  const cancelled = deferred<boolean>();
  const started = deferred<void>();
  f.api.cancelPolicy.mockImplementation(() => {
    started.resolve();
    return cancelled.promise;
  });
  const back = f.panel.backPolicy();
  await started.promise;
  expect(f.states[f.states.length - 1]?.status).toBe("policyLoading");
  await f.panel.dispose();
  const count = f.publish.mock.calls.length;
  cancelled.resolve(true);
  await back;
  expect(f.publish).toHaveBeenCalledTimes(count);
  expect(f.api.confirmPolicy).not.toHaveBeenCalled();
});

it("requires another manual review after back, failed confirmation or failed cleanup", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configurePolicy();
  await f.panel.reviewPolicy("always");
  await f.panel.backPolicy();
  expect(f.api.cancelPolicy).toHaveBeenCalledWith(selected);
  expect(f.states[f.states.length - 1]?.status).toBe("policyConfiguring");
  await f.panel.confirmPolicy(reviewed);
  expect(f.api.confirmPolicy).not.toHaveBeenCalled();
  await f.panel.reviewPolicy("always");
  f.api.confirmPolicy.mockRejectedValueOnce({ code: "stale" });
  await f.panel.confirmPolicy(reviewed);
  expect(f.states[f.states.length - 1]).toEqual({
    status: "policyError",
    code: "stale",
  });
  await f.panel.confirmPolicy(reviewed);
  expect(f.api.confirmPolicy).toHaveBeenCalledOnce();
  f.api.cancelPolicy.mockRejectedValueOnce({ code: "busy" });
  await f.panel.backPolicy();
  expect(f.states[f.states.length - 1]).toEqual({
    status: "policyError",
    code: "busy",
  });
  await f.panel.backPolicy();
  expect(f.states[f.states.length - 1]?.status).toBe("policyConfiguring");
  await f.panel.dispose();
});

it("keeps policy results and errors separate from deployment and trust states", async () => {
  const f = fixture();
  await f.panel.load();
  f.panel.configurePolicy();
  f.api.reviewPolicy.mockRejectedValueOnce({ code: "scope" });
  await f.panel.reviewPolicy("always");
  expect(f.states[f.states.length - 1]).toEqual({
    status: "policyError",
    code: "scope",
  });
  expect(
    f.states.some(
      (state) =>
        state.status === "deploymentError" || state.status === "trustError",
    ),
  ).toBe(false);
  await f.panel.dispose();
});
