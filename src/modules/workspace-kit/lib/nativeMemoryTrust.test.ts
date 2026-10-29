import { beforeEach, expect, it, vi } from "vitest";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import {
  trustReply,
  trustAccepted,
  trustText,
} from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const handle = { id: 1, token: "owner" };
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { request?: { revision: number } }) => {
      if (command === "project_memory_open") return handle;
      if (command === "project_memory_select") return "selection";
      if (command === "project_memory_review_trust")
        return trustReply(args?.request?.revision);
      if (command === "project_memory_confirm_trust") return trustAccepted;
      if (command === "project_memory_cancel_trust") return true;
    },
  );
});
async function setup() {
  const owner = createNativeMemoryPresentation();
  const selected = await owner.select("/project", { kind: "local" });
  return { owner, selected };
}
it("keeps exact immutable review bytes and confirms only the retained native token once", async () => {
  const { owner, selected } = await setup();
  const wire = trustReply();
  Object.assign(wire, { privatePreferences: "unrelated native state" });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_review_trust"
      ? Promise.resolve(wire)
      : original?.(command, args),
  );
  const accepted = await owner.reviewTrust(selected);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_review_trust", {
    handle,
    selection: "selection",
    request: { revision: 1, role: null },
  });
  wire.instructions.files[0].fact.text = "Edited wire";
  expect(accepted.snapshot.instructions.files[0].fact).toEqual({
    kind: "file",
    text: trustText,
  });
  expect(Object.isFrozen(accepted.snapshot.instructions.files[0].fact)).toBe(
    true,
  );
  expect(Object.isFrozen(accepted.snapshot.config.capture)).toBe(true);
  expect(accepted.snapshot).not.toHaveProperty("review");
  expect(accepted.snapshot).not.toHaveProperty("revision");
  expect(accepted.snapshot).not.toHaveProperty("privatePreferences");
  expect(await owner.confirmTrust(selected, accepted)).toEqual(trustAccepted);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_trust", {
    handle,
    selection: "selection",
    review: wire.review,
  });
  await expect(owner.confirmTrust(selected, accepted)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(owner.isTrustReviewCurrent(selected, accepted)).toBe(false);
  await owner.close();
});
it("rejects copied and foreign reviews, and coalesces confirmation through actual settlement", async () => {
  const { owner, selected } = await setup();
  const other = await setup();
  const accepted = await owner.reviewTrust(selected);
  await expect(
    owner.confirmTrust(selected, { ...accepted }),
  ).rejects.toMatchObject({ code: "cancelled" });
  await expect(
    other.owner.confirmTrust(other.selected, accepted),
  ).rejects.toMatchObject({ code: "cancelled" });
  const write = deferred<typeof trustAccepted>();
  const started = deferred<void>();
  invoke.mockImplementation((command) => {
    if (command === "project_memory_confirm_trust") {
      started.resolve();
      return write.promise;
    }
    return Promise.resolve();
  });
  const first = owner.confirmTrust(selected, accepted);
  expect(owner.confirmTrust(selected, accepted)).toBe(first);
  await started.promise;
  expect(owner.confirmTrust(selected, accepted)).toBe(first);
  write.resolve(trustAccepted);
  await first;
  await owner.close();
  await other.owner.close();
});
it("cancels by revision before a token exists, coalesces cleanup and suppresses late private failures", async () => {
  const { owner, selected } = await setup();
  const read = deferred<ReturnType<typeof trustReply>>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_review_trust") {
      started.resolve();
      return read.promise;
    }
    return original?.(command, args);
  });
  const opening = owner.reviewTrust(selected).catch((error: unknown) => error);
  await started.promise;
  const cancel = owner.cancelTrust(selected);
  expect(owner.cancelTrust(selected)).toBe(cancel);
  await cancel;
  expect(invoke).toHaveBeenLastCalledWith("project_memory_cancel_trust", {
    handle,
    selection: "selection",
    revision: 1,
  });
  read.reject({ code: "private native details" });
  expect(await opening).toMatchObject({ code: "cancelled" });
  await owner.close();
});
it("retries failed cancellation without borrowing or cancelling a successor", async () => {
  const { owner, selected } = await setup();
  const first = await owner.reviewTrust(selected);
  const original = invoke.getMockImplementation();
  let fail = true;
  invoke.mockImplementation((command, args) =>
    command === "project_memory_cancel_trust" && fail
      ? Promise.reject({ code: "busy" })
      : original?.(command, args),
  );
  await expect(owner.cancelTrust(selected)).rejects.toMatchObject({
    code: "busy",
  });
  expect(owner.isTrustReviewCurrent(selected, first)).toBe(false);
  fail = false;
  await owner.cancelTrust(selected);
  const second = await owner.reviewTrust(selected);
  await expect(owner.confirmTrust(selected, first)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(owner.isTrustReviewCurrent(selected, second)).toBe(true);
  await owner.close();
});

it("suppresses retired confirmation failures without consuming a successor", async () => {
  const { owner, selected } = await setup();
  const accepted = await owner.reviewTrust(selected);
  const write = deferred<typeof trustAccepted>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_confirm_trust") {
      started.resolve();
      return write.promise;
    }
    return original?.(command, args);
  });
  const pending = owner
    .confirmTrust(selected, accepted)
    .catch((error: unknown) => error);
  await started.promise;
  const next = await owner.reviewTrust(selected);
  write.reject({ code: "private original error" });
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(owner.isTrustReviewCurrent(selected, next)).toBe(true);
  await owner.close();
});

it.each(["schema", "key", "digest", "policy"])(
  "consumes malformed native acceptance without retry (%s)",
  async (field) => {
    const { owner, selected } = await setup();
    const accepted = await owner.reviewTrust(selected);
    const bad = structuredClone(trustAccepted);
    const response =
      field === "schema"
        ? { ...bad, schema: 2 }
        : {
            ...bad,
            preference: {
              ...bad.preference,
              ...(field === "key"
                ? { projectKey: "d".repeat(64) }
                : field === "digest"
                  ? { instructionDigest: "d".repeat(64) }
                  : { policy: "always" }),
            },
          };
    invoke.mockResolvedValueOnce(response);
    await expect(owner.confirmTrust(selected, accepted)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(owner.confirmTrust(selected, accepted)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "project_memory_confirm_trust",
      ),
    ).toHaveLength(1);
    await owner.close();
  },
);
it.each(["select", "close"] as const)(
  "retires a pending trust result synchronously on %s",
  async (operation) => {
    const { owner, selected } = await setup();
    const read = deferred<ReturnType<typeof trustReply>>();
    const started = deferred<void>();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) => {
      if (command === "project_memory_review_trust") {
        started.resolve();
        return read.promise;
      }
      return original?.(command, args);
    });
    const pending = owner
      .reviewTrust(selected)
      .catch((error: unknown) => error);
    await started.promise;
    if (operation === "close") await owner.close();
    else await owner.select("/project", { kind: "local" });
    read.resolve(trustReply());
    expect(await pending).toMatchObject({ code: "cancelled" });
    await owner.close();
  },
);
it("shares the deployment request budget through physical settlement of replaced trust calls", async () => {
  const { owner, selected } = await setup();
  let started = deferred<void>();
  const reads: {
    resolve: (reply: unknown) => void;
    revision: number;
    trust: boolean;
  }[] = [];
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (
      command === "project_memory_review_trust" ||
      command === "project_memory_preview"
    ) {
      const read = deferred<unknown>();
      reads.push({
        resolve: read.resolve,
        revision: args.request.revision,
        trust: command === "project_memory_review_trust",
      });
      started.resolve();
      return read.promise;
    }
    return original?.(command, args);
  });
  const pending: Promise<unknown>[] = [];
  for (let index = 0; index < 256; index++) {
    started = deferred<void>();
    const job =
      index % 2
        ? owner.reviewTrust(selected)
        : owner.preview(selected, {
            destination: "/project",
            environment: { kind: "local" },
            inputs: {},
            links: { agents: false, claude: false },
          });
    pending.push(job.catch((error: unknown) => error));
    await started.promise;
  }
  await expect(owner.reviewTrust(selected)).rejects.toMatchObject({
    code: "busy",
  });
  expect(reads).toHaveLength(256);
  for (const read of reads)
    read.resolve(
      read.trust
        ? trustReply(read.revision)
        : {
            schema: 1,
            root: "/project",
            review: "deployment",
            revision: read.revision,
            deployment: { entries: [], canPublish: true, lock: null },
            isResuming: false,
            recoveryFiles: [],
            publicationBlocker: null,
          },
    );
  const settled = await Promise.all(pending);
  const last = settled[255] as Awaited<ReturnType<typeof owner.reviewTrust>>;
  expect(owner.isTrustReviewCurrent(selected, last)).toBe(true);
  await owner.close();
});
it.each(["root", "token", "hash", "text", "inventory", "preference", "config"])(
  "rejects malformed or unbounded trust display data (%s)",
  async (kind) => {
    const { owner, selected } = await setup();
    const wire = trustReply();
    if (kind === "root") wire.root = "bad\nroot";
    if (kind === "token") wire.review = "invented";
    if (kind === "hash") wire.fingerprint.digest = "bad";
    if (kind === "text")
      wire.instructions.files[0].fact.text = "ñ".repeat(131073);
    if (kind === "inventory") wire.fingerprint.files = [];
    const result: unknown =
      kind === "preference"
        ? {
            ...wire,
            preference: {
              ...trustAccepted.preference,
              projectKey: "d".repeat(64),
            },
          }
        : kind === "config"
          ? { ...wire, config: { cycle: wire } }
          : wire;
    if (kind === "config")
      (result as { config: { cycle: unknown } }).config.cycle = result;
    invoke.mockResolvedValueOnce(result);
    await expect(owner.reviewTrust(selected)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "project_memory_confirm_trust",
      ),
    ).toBe(false);
    await owner.close();
  },
);
