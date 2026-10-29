import { beforeEach, expect, it, vi } from "vitest";
import {
  createNativeMemoryPresentation,
  type NativeMemoryPreviewInput,
} from "@/modules/workspace-kit/lib/nativeMemory";

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
const input: NativeMemoryPreviewInput = {
  destination: "/project",
  environment: { kind: "local" },
  inputs: { PROJECT_NAME: "original" },
  links: { agents: false, claude: false },
};
const publication = {
  schema: 1,
  created: [".voktty/kit.json"],
  skipped: [],
  migrated: [],
  cleaned: [],
};
function reply(revision = 1) {
  return {
    schema: 1,
    root: "/project",
    revision,
    review: `native-review-${revision}`,
    deployment: { entries: [], canPublish: true, lock: null },
    isResuming: false,
    recoveryFiles: [],
    publicationBlocker: null,
  };
}
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { request?: { revision: number } }) => {
      if (command === "project_memory_open") return handle;
      if (command === "project_memory_select") return "selection";
      if (command === "project_memory_preview")
        return reply(args?.request?.revision);
      if (command === "project_memory_confirm_preview") return publication;
      if (command === "project_memory_cancel_preview") return true;
    },
  );
});
async function setup() {
  const owner = createNativeMemoryPresentation();
  const selected = await owner.select("/project", { kind: "local" });
  return { owner, selected };
}

it("captures preview inputs before awaiting and sends only the native token to confirm", async () => {
  const { owner, selected } = await setup();
  const captured = {
    ...structuredClone(input),
    inputs: { PROJECT_NAME: "original" },
  };
  const pending = owner.preview(selected, captured);
  captured.inputs.PROJECT_NAME = "replacement";
  const accepted = await pending;
  expect(invoke).toHaveBeenCalledWith("project_memory_preview", {
    handle,
    selection: "selection",
    request: { ...input, revision: 1 },
  });
  expect(accepted.snapshot).not.toHaveProperty("review");
  expect(await owner.confirmPreview(selected, accepted)).toEqual(publication);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_preview", {
    handle,
    selection: "selection",
    review: "native-review-1",
  });
  await expect(owner.confirmPreview(selected, accepted)).rejects.toMatchObject({
    code: "cancelled",
  });
  await owner.close();
});

it.each([undefined, "", "bad\nroot", "x".repeat(4097)])(
  "rejects a missing or invalid display root before review adoption (%s)",
  async (root) => {
    const { owner, selected } = await setup();
    invoke.mockImplementation(async (command: string) =>
      command === "project_memory_preview" ? { ...reply(), root } : undefined,
    );
    await expect(owner.preview(selected, input)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "project_memory_confirm_preview",
      ),
    ).toHaveLength(0);
    await owner.close();
  },
);

it("coalesces actual confirmation settlement and preserves a partial-write failure once", async () => {
  const { owner, selected } = await setup();
  const accepted = await owner.preview(selected, input);
  const write = deferred<typeof publication>();
  const started = deferred<void>();
  const failure = {
    code: "recoveryRequired",
    changes: {
      created: [".voktty/INIT.md"],
      migrated: [],
      cleaned: [],
      possibleRecoveryFiles: [".voktty/backup"],
    },
  };
  invoke.mockImplementation((command: string) => {
    if (command === "project_memory_confirm_preview") {
      started.resolve();
      return write.promise;
    }
    return Promise.resolve();
  });
  const pending = owner.confirmPreview(selected, accepted);
  expect(owner.confirmPreview(selected, accepted)).toBe(pending);
  const rejected = expect(pending).rejects.toBe(failure);
  await started.promise;
  write.reject(failure);
  await rejected;
  await expect(owner.confirmPreview(selected, accepted)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_preview",
    ),
  ).toHaveLength(1);
  await owner.close();
});

it("rejects copied, foreign and superseded reviews before publication", async () => {
  const { owner, selected } = await setup();
  const other = await setup();
  const first = await owner.preview(selected, input);
  expect(owner.isReviewCurrent(selected, first)).toBe(true);
  const foreign = await other.owner.preview(other.selected, input);
  const current = await owner.preview(selected, input);
  expect(owner.isReviewCurrent(selected, first)).toBe(false);
  expect(owner.isReviewCurrent(selected, { ...current })).toBe(false);
  expect(owner.isReviewCurrent(selected, current)).toBe(true);
  for (const receipt of [first, foreign, { ...current }])
    await expect(owner.confirmPreview(selected, receipt)).rejects.toMatchObject(
      { code: "cancelled" },
    );
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_preview",
    ),
  ).toHaveLength(0);
  await owner.confirmPreview(selected, current);
  expect(owner.isReviewCurrent(selected, current)).toBe(false);
  await owner.close();
  await other.owner.close();
});

it.each([false, true])(
  "suppresses a superseded preview result/error (%s) and keeps monotonic revisions",
  async (reject) => {
    const { owner, selected } = await setup();
    const old = deferred<ReturnType<typeof reply>>();
    const started = deferred<void>();
    invoke.mockImplementation(
      async (command: string, args?: { request?: { revision: number } }) => {
        if (command === "project_memory_preview") {
          if (args?.request?.revision === 1) {
            started.resolve();
            return old.promise;
          }
          return reply(args?.request?.revision);
        }
        if (command === "project_memory_confirm_preview") return publication;
      },
    );
    const pending = owner.preview(selected, input);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await started.promise;
    const current = await owner.preview(selected, input);
    if (reject) old.reject({ code: "unavailable" });
    else old.resolve(reply());
    await rejected;
    await owner.confirmPreview(selected, current);
    expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_preview", {
      handle,
      selection: "selection",
      review: "native-review-2",
    });
    await owner.close();
  },
);

it("cancels before the token is known, coalesces cancellation and rejects a late preview", async () => {
  const { owner, selected } = await setup();
  const read = deferred<ReturnType<typeof reply>>();
  const cancel = deferred<boolean>();
  const started = deferred<void>();
  invoke.mockImplementation((command: string) => {
    if (command === "project_memory_preview") {
      started.resolve();
      return read.promise;
    }
    if (command === "project_memory_cancel_preview") return cancel.promise;
    return Promise.resolve();
  });
  const pending = owner.preview(selected, input);
  const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  const cancelling = owner.cancelPreview(selected);
  expect(owner.cancelPreview(selected)).toBe(cancelling);
  cancel.resolve(true);
  expect(await cancelling).toBe(true);
  expect(invoke).toHaveBeenCalledWith("project_memory_cancel_preview", {
    handle,
    selection: "selection",
    revision: 1,
  });
  read.resolve(reply());
  await rejected;
  await owner.close();
});

it("cancellation before preview dispatch fences that revision without admitting preview IPC", async () => {
  const { owner, selected } = await setup();
  const pending = owner.preview(selected, input);
  const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await owner.cancelPreview(selected);
  await rejected;
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_preview",
    ),
  ).toHaveLength(0);
  const fresh = await owner.preview(selected, input);
  await owner.confirmPreview(selected, fresh);
  await owner.close();
});

it.each([false, true])(
  "suppresses settlement between transport and snapshot adoption (%s)",
  async (reject) => {
    const { owner, selected } = await setup();
    const read = deferred<ReturnType<typeof reply>>();
    const started = deferred<void>();
    invoke.mockImplementation((command: string) => {
      if (command === "project_memory_preview") {
        started.resolve();
        return read.promise;
      }
      return Promise.resolve(true);
    });
    const pending = owner.preview(selected, input);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await started.promise;
    let cancelling: Promise<boolean> | undefined;
    if (reject) read.reject({ code: "unavailable" });
    else read.resolve(reply());
    queueMicrotask(() => {
      cancelling = owner.cancelPreview(selected);
    });
    await rejected;
    await cancelling;
    await owner.close();
  },
);

it.each([false, true])(
  "suppresses a publication after selection retirement (%s)",
  async (reject) => {
    const { owner, selected } = await setup();
    const accepted = await owner.preview(selected, input);
    const write = deferred<typeof publication>();
    const started = deferred<void>();
    invoke.mockImplementation(async (command: string) => {
      if (command === "project_memory_confirm_preview") {
        started.resolve();
        return write.promise;
      }
      if (command === "project_memory_select") return "replacement";
    });
    const pending = owner.confirmPreview(selected, accepted);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await started.promise;
    await owner.select("/other", { kind: "local" });
    await owner.select("/project", { kind: "local" });
    if (reject) write.reject({ code: "recoveryRequired" });
    else write.resolve(publication);
    await rejected;
    await owner.close();
  },
);

it("keeps failed cancellation retryable without reviving confirmation", async () => {
  const { owner, selected } = await setup();
  const accepted = await owner.preview(selected, input);
  invoke.mockRejectedValueOnce({ code: "unavailable" });
  await expect(owner.cancelPreview(selected)).rejects.toMatchObject({
    code: "unavailable",
  });
  await expect(owner.confirmPreview(selected, accepted)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(await owner.cancelPreview(selected)).toBe(true);
  await owner.close();
});

it.each([false, true])(
  "suppresses confirmation retired between transport and consumption (%s)",
  async (reject) => {
    const { owner, selected } = await setup();
    const accepted = await owner.preview(selected, input);
    const write = deferred<typeof publication>();
    const started = deferred<void>();
    invoke.mockImplementation((command: string) => {
      if (command === "project_memory_confirm_preview") {
        started.resolve();
        return write.promise;
      }
      return Promise.resolve(true);
    });
    const pending = owner.confirmPreview(selected, accepted);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await started.promise;
    let cancelling: Promise<boolean> | undefined;
    if (reject) write.reject({ code: "recoveryRequired" });
    else write.resolve(publication);
    queueMicrotask(() => {
      cancelling = owner.cancelPreview(selected);
    });
    await rejected;
    await cancelling;
    await owner.close();
  },
);

it("retains superseded requests against capacity until actual settlement", async () => {
  const { owner, selected } = await setup();
  const reads: ReturnType<typeof deferred<ReturnType<typeof reply>>>[] = [];
  let started = deferred<void>();
  invoke.mockImplementation((command: string) => {
    if (command === "project_memory_preview") {
      const read = deferred<ReturnType<typeof reply>>();
      reads.push(read);
      started.resolve();
      return read.promise;
    }
    if (command === "project_memory_confirm_preview")
      return Promise.resolve(publication);
    return Promise.resolve();
  });
  const pending = [];
  for (let index = 0; index < 256; index += 1) {
    started = deferred<void>();
    pending.push(
      owner.preview(selected, input).catch((error: unknown) => error),
    );
    await started.promise;
  }
  await expect(owner.preview(selected, input)).rejects.toMatchObject({
    code: "busy",
  });
  expect(reads).toHaveLength(256);
  for (let index = 0; index < reads.length; index += 1)
    reads[index].resolve(reply(index + 1));
  const results = await Promise.all(pending);
  expect(results.slice(0, -1)).toEqual(
    Array.from({ length: 255 }, () =>
      expect.objectContaining({ code: "cancelled" }),
    ),
  );
  const accepted = results[255] as Awaited<ReturnType<typeof owner.preview>>;
  await owner.confirmPreview(selected, accepted);
  started = deferred<void>();
  const fresh = owner.preview(selected, input);
  await started.promise;
  reads[256].resolve(reply(257));
  await fresh;
  await owner.close();
});

it("retires an opening review on close and captures Docker identity without local fallback", async () => {
  const { owner, selected } = await setup();
  const read = deferred<ReturnType<typeof reply>>();
  const started = deferred<void>();
  invoke.mockImplementation((command: string) => {
    if (command === "project_memory_preview") {
      started.resolve();
      return read.promise;
    }
    return Promise.resolve();
  });
  const connection = {
    containerId: "id",
    containerName: "name",
    image: "image",
    kind: "local",
  };
  const pending = owner.preview(selected, {
    ...input,
    environment: { kind: "docker", connection },
  });
  const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  connection.containerId = "changed";
  await started.promise;
  expect(invoke).toHaveBeenCalledWith("project_memory_preview", {
    handle,
    selection: "selection",
    request: {
      ...input,
      revision: 1,
      environment: {
        containerId: "id",
        containerName: "name",
        image: "image",
        kind: "docker",
      },
    },
  });
  await owner.close();
  read.resolve(reply());
  await rejected;
  await expect(owner.preview(selected, input)).rejects.toMatchObject({
    code: "cancelled",
  });
});
