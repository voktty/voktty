import { beforeEach, expect, it, vi } from "vitest";
import {
  createNativeMemoryPresentation,
  type NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import {
  createNativeMemoryPolicyClient,
  type NativeMemoryPolicy,
} from "@/modules/workspace-kit/lib/nativeMemoryPolicy";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const handle = { id: 1, token: "owner" };
const key = "a".repeat(64);
function reply(revision = 1, policy: NativeMemoryPolicy = "always") {
  return {
    schema: 1,
    review: `00000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
    revision,
    root: "/canonical/project",
    projectKey: key,
    policy,
    preference: {
      projectKey: key,
      policy: "manual" as NativeMemoryPolicy,
      instructionDigest: null as string | null,
    },
  };
}
function accepted(
  policy: NativeMemoryPolicy = "always",
  instructionDigest: string | null = null,
) {
  return {
    schema: 1,
    preference: { projectKey: key, policy, instructionDigest },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  invoke.mockReset();
  let choice: NativeMemoryPolicy = "always";
  invoke.mockImplementation(
    async (
      command: string,
      args?: { request?: { revision: number; policy: NativeMemoryPolicy } },
    ) => {
      if (command === "project_memory_open") return handle;
      if (command === "project_memory_select") return "selection";
      if (command === "project_memory_review_policy") {
        choice = args?.request?.policy ?? "always";
        return reply(args?.request?.revision, choice);
      }
      if (command === "project_memory_confirm_policy") return accepted(choice);
      if (command === "project_memory_cancel_policy") return true;
      if (command === "project_memory_review_trust")
        return trustReply(args?.request?.revision);
    },
  );
});
async function setup() {
  const owner = createNativeMemoryPresentation();
  const selected = await owner.select("/project", { kind: "local" });
  return { owner, selected };
}

it("retains a detached immutable choice and confirms only its native token", async () => {
  const { owner, selected } = await setup();
  const wire = reply();
  wire.preference.instructionDigest = "c".repeat(64);
  Object.assign(wire, {
    privatePreferences: "unrelated",
    session: "unrelated",
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_review_policy"
      ? Promise.resolve(wire)
      : command === "project_memory_confirm_policy"
        ? Promise.resolve(accepted("always", "c".repeat(64)))
        : original?.(command, args),
  );
  const review = await owner.reviewPolicy(selected, "always");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_review_policy", {
    handle,
    selection: "selection",
    request: { revision: 1, policy: "always" },
  });
  wire.root = "/changed";
  wire.policy = "never";
  wire.preference.policy = "always";
  wire.preference.instructionDigest = null;
  expect(review.snapshot).toEqual({
    schema: 1,
    root: "/canonical/project",
    projectKey: key,
    policy: "always",
    preference: {
      projectKey: key,
      policy: "manual",
      instructionDigest: "c".repeat(64),
    },
  });
  expect(Object.isFrozen(review)).toBe(true);
  expect(Object.isFrozen(review.snapshot)).toBe(true);
  expect(Object.isFrozen(review.snapshot.preference)).toBe(true);
  expect(await owner.confirmPolicy(selected, review)).toEqual(
    accepted("always", "c".repeat(64)),
  );
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_policy", {
    handle,
    selection: "selection",
    review: wire.review,
  });
  await expect(owner.confirmPolicy(selected, review)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(owner.isPolicyReviewCurrent(selected, review)).toBe(false);
  await owner.close();
});

it.each(["manual", "always", "never"] as const)(
  "sends the explicit %s choice without a session grant",
  async (choice) => {
    const { owner, selected } = await setup();
    const review = await owner.reviewPolicy(selected, choice);
    expect(review.snapshot.policy).toBe(choice);
    expect(
      (await owner.confirmPolicy(selected, review)).preference.policy,
    ).toBe(choice);
    expect(
      invoke.mock.calls.filter(
        ([name]) => name === "project_memory_review_policy",
      )[0][1].request,
    ).toEqual({ revision: 1, policy: choice });
    await owner.close();
  },
);

it("accepts a fresh project's null preference at the exact UTF-8 root limit", async () => {
  const { owner, selected } = await setup();
  const root = `/${"é".repeat(2047)}x`;
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) =>
    name === "project_memory_review_policy"
      ? Promise.resolve({ ...reply(), root, preference: null })
      : original?.(name, args),
  );
  const review = await owner.reviewPolicy(selected, "always");
  expect(new TextEncoder().encode(review.snapshot.root)).toHaveLength(4096);
  expect(review.snapshot.preference).toBeNull();
  expect(await owner.confirmPolicy(selected, review)).toEqual(accepted());
  await owner.close();
});

it("rejects copied and foreign receipts while coalescing confirmation through settlement", async () => {
  const { owner, selected } = await setup();
  const other = await setup();
  const review = await owner.reviewPolicy(selected, "always");
  await expect(
    owner.confirmPolicy(selected, { ...review }),
  ).rejects.toMatchObject({ code: "cancelled" });
  await expect(
    other.owner.confirmPolicy(other.selected, review),
  ).rejects.toMatchObject({ code: "cancelled" });
  const write = deferred<ReturnType<typeof accepted>>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) => {
    if (name === "project_memory_confirm_policy") {
      started.resolve();
      return write.promise;
    }
    return original?.(name, args);
  });
  const first = owner.confirmPolicy(selected, review);
  expect(owner.confirmPolicy(selected, review)).toBe(first);
  await started.promise;
  expect(owner.isPolicyReviewCurrent(selected, review)).toBe(true);
  write.resolve(accepted());
  await first;
  expect(
    invoke.mock.calls.filter(
      ([name]) => name === "project_memory_confirm_policy",
    ),
  ).toHaveLength(1);
  await owner.close();
  await other.owner.close();
});

it("retains original errors once and requires a new review after confirmation failure", async () => {
  const { owner, selected } = await setup();
  const review = await owner.reviewPolicy(selected, "always");
  const original = invoke.getMockImplementation();
  const error = { code: "stale" };
  invoke.mockImplementation((name, args) =>
    name === "project_memory_confirm_policy"
      ? Promise.reject(error)
      : original?.(name, args),
  );
  await expect(owner.confirmPolicy(selected, review)).rejects.toBe(error);
  await expect(owner.confirmPolicy(selected, review)).rejects.toMatchObject({
    code: "cancelled",
  });
  const fresh = await owner.reviewPolicy(selected, "never");
  expect(owner.isPolicyReviewCurrent(selected, fresh)).toBe(true);
  expect(
    invoke.mock.calls
      .filter(([name]) => name === "project_memory_review_policy")
      .map(([, args]) => args.request.revision),
  ).toEqual([1, 2]);
  await owner.close();
});

it.each([false, true])(
  "retires an opening on selection replacement or close (%s) without late publication",
  async (close) => {
    const { owner, selected } = await setup();
    const opening = deferred<ReturnType<typeof reply>>();
    const started = deferred<void>();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((name, args) => {
      if (name === "project_memory_review_policy") {
        started.resolve();
        return opening.promise;
      }
      return original?.(name, args);
    });
    const pending = owner.reviewPolicy(selected, "always");
    const checked = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await started.promise;
    if (close) await owner.close();
    else await owner.select("/project", { kind: "local" });
    opening.resolve(reply());
    await checked;
    await owner.close();
  },
);

it("new reviews retire previous outcomes and old error cleanup cannot cancel a successor", async () => {
  const { owner, selected } = await setup();
  const old = deferred<ReturnType<typeof reply>>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) => {
    if (
      name === "project_memory_review_policy" &&
      args.request.revision === 1
    ) {
      started.resolve();
      return old.promise;
    }
    return original?.(name, args);
  });
  const pending = owner.reviewPolicy(selected, "always");
  const checked = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  const fresh = await owner.reviewPolicy(selected, "never");
  old.reject({ code: "unavailable" });
  await checked;
  expect(owner.isPolicyReviewCurrent(selected, fresh)).toBe(true);
  expect((await owner.confirmPolicy(selected, fresh)).preference.policy).toBe(
    "never",
  );
  await owner.close();
});

it("cancels an opening synchronously by revision and permits exact cleanup retry", async () => {
  const { owner, selected } = await setup();
  const pendingReply = deferred<ReturnType<typeof reply>>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  let cancelled = false;
  invoke.mockImplementation((name, args) => {
    if (name === "project_memory_review_policy") {
      started.resolve();
      return pendingReply.promise;
    }
    if (name === "project_memory_cancel_policy") {
      if (!cancelled) {
        cancelled = true;
        return Promise.reject({ code: "busy" });
      }
      return Promise.resolve(true);
    }
    return original?.(name, args);
  });
  const opening = owner.reviewPolicy(selected, "always");
  const checked = expect(opening).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  const first = owner.cancelPolicy(selected);
  expect(owner.cancelPolicy(selected)).toBe(first);
  await expect(first).rejects.toMatchObject({ code: "busy" });
  pendingReply.resolve(reply());
  await checked;
  expect(await owner.cancelPolicy(selected)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_cancel_policy", {
    handle,
    selection: "selection",
    revision: 1,
  });
  await owner.close();
});

it("cancellation of an admitted confirmation suppresses delivery without claiming rollback", async () => {
  const { owner, selected } = await setup();
  const review = await owner.reviewPolicy(selected, "always");
  const write = deferred<ReturnType<typeof accepted>>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) => {
    if (name === "project_memory_confirm_policy") {
      started.resolve();
      return write.promise;
    }
    return original?.(name, args);
  });
  const pending = owner.confirmPolicy(selected, review);
  const checked = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  const cancellation = owner.cancelPolicy(selected);
  expect(owner.isPolicyReviewCurrent(selected, review)).toBe(false);
  await cancellation;
  write.resolve(accepted());
  await checked;
  expect(
    invoke.mock.calls.filter(
      ([name]) => name === "project_memory_confirm_policy",
    ),
  ).toHaveLength(1);
  await owner.close();
});

it("shares the unsettled budget with trust, including retired policy work until settlement", async () => {
  const { owner, selected } = await setup();
  const pending: Promise<unknown>[] = [];
  const calls: ReturnType<typeof deferred<ReturnType<typeof reply>>>[] = [];
  let entered = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) => {
    if (name === "project_memory_review_policy") {
      const call = deferred<ReturnType<typeof reply>>();
      calls.push(call);
      entered.resolve();
      return call.promise;
    }
    return original?.(name, args);
  });
  for (let index = 0; index < 256; index += 1) {
    entered = deferred<void>();
    pending.push(
      owner.reviewPolicy(selected, "always").catch((error: unknown) => error),
    );
    await entered.promise;
    expect(calls).toHaveLength(index + 1);
  }
  await expect(owner.reviewTrust(selected)).rejects.toMatchObject({
    code: "busy",
  });
  await expect(owner.reviewPolicy(selected, "never")).rejects.toMatchObject({
    code: "busy",
  });
  calls[0].resolve(reply(1));
  await pending[0];
  const trusted = await owner.reviewTrust(selected);
  expect(owner.isTrustReviewCurrent(selected, trusted)).toBe(true);
  for (let index = 1; index < 256; index += 1)
    calls[index].resolve(reply(index + 1));
  await Promise.all(pending);
  await owner.close();
});

it.each([
  { schema: 2 },
  { revision: 2 },
  { policy: "never" },
  { projectKey: "bad" },
  { projectKey: `${key}\n` },
  { review: "token" },
  { review: `${reply().review}\n` },
  { root: "" },
  { root: "x".repeat(4097) },
  { root: "é".repeat(2049) },
  { root: "/bad\0root" },
  { root: "/bad\ud800" },
  { preference: undefined },
  {
    preference: {
      projectKey: "b".repeat(64),
      policy: "manual",
      instructionDigest: null,
    },
  },
  { preference: { projectKey: key, policy: "ask", instructionDigest: null } },
  {
    preference: {
      projectKey: key,
      policy: "manual",
      instructionDigest: `${"c".repeat(64)}\n`,
    },
  },
])(
  "rejects malformed native review metadata %j before confirmation",
  async (change) => {
    const { owner, selected } = await setup();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((name, args) =>
      name === "project_memory_review_policy"
        ? Promise.resolve({ ...reply(), ...change })
        : original?.(name, args),
    );
    await expect(owner.reviewPolicy(selected, "always")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(
      invoke.mock.calls.some(
        ([name]) => name === "project_memory_confirm_policy",
      ),
    ).toBe(false);
    await owner.close();
  },
);

it.each([
  null,
  {},
  { schema: 2, preference: accepted().preference },
  accepted("never"),
  accepted("always", "b".repeat(64)),
  {
    schema: 1,
    preference: { ...accepted().preference, projectKey: "b".repeat(64) },
  },
])(
  "consumes malformed confirmation replies %j without reporting success",
  async (wire) => {
    const { owner, selected } = await setup();
    const review = await owner.reviewPolicy(selected, "always");
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((name, args) =>
      name === "project_memory_confirm_policy"
        ? Promise.resolve(wire)
        : original?.(name, args),
    );
    await expect(owner.confirmPolicy(selected, review)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(owner.confirmPolicy(selected, review)).rejects.toMatchObject({
      code: "cancelled",
    });
    await owner.close();
  },
);

it("validates cancellation receipts and rejects unsupported runtime policy values before IPC", async () => {
  const { owner, selected } = await setup();
  expect(await owner.cancelPolicy(selected)).toBe(false);
  const review = await owner.reviewPolicy(selected, "always");
  await expect(
    owner.reviewPolicy(selected, "ask" as NativeMemoryPolicy),
  ).rejects.toMatchObject({ code: "invalidInput" });
  expect(owner.isPolicyReviewCurrent(selected, review)).toBe(true);
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) =>
    name === "project_memory_cancel_policy"
      ? Promise.resolve("true")
      : original?.(name, args),
  );
  await expect(owner.cancelPolicy(selected)).rejects.toMatchObject({
    code: "unavailable",
  });
  await owner.close();
});

it("rechecks the original cancellation owner after its request promise fulfills", async () => {
  const { owner, selected } = await setup();
  let retire = () => {};
  const client = createNativeMemoryPolicyClient({
    checkSelection: (selection) => {
      expect(selection).toBe(selected);
    },
    canRequest: () => true,
    request: async <T>(
      _selection: NativeMemorySelection,
      command: string,
      _args: Record<string, unknown>,
      check: () => void,
    ): Promise<T> => {
      check();
      if (command === "project_memory_review_policy") return reply() as T;
      queueMicrotask(retire);
      return true as T;
    },
  });
  retire = client.retire;
  await client.api.reviewPolicy(selected, "always");
  await expect(client.api.cancelPolicy(selected)).rejects.toMatchObject({
    code: "cancelled",
  });
  await owner.close();
});
