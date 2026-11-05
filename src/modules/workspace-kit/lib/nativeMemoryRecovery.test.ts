import {
  createNativeMemoryPresentation,
  type NativeMemoryReview,
} from "@/modules/workspace-kit/lib/nativeMemory";
import {
  memoryRecoveryReview,
  memoryRestorationReport,
  type NativeMemoryRecoveryReview,
} from "@/modules/workspace-kit/lib/nativeMemoryRecovery";
import { beforeEach, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const token = "12345678-1234-4234-8234-123456789abc";
const backup = `.voktty/.voktty-migration-${token}-2`;
const handle = { id: 17, token: "original-owner" };
const input = {
  destination: "/project",
  environment: { kind: "local" as const },
};
const previewInput = {
  ...input,
  inputs: { project_name: "Example" },
  links: { agents: false, claude: false },
};
function reply(revision = 1) {
  return {
    schema: 2,
    revision,
    review: token,
    digest: "a".repeat(64),
    root: "/project",
    entries: [{ target: ".voktty/.gitignore", backup, text: "*\r\n" }],
    deployment: {
      entries: [
        {
          path: ".voktty/kit.json",
          action: "create",
          reason: "missing",
          expected: null,
          proposed: "{}",
        },
      ],
      canPublish: true,
      lock: null,
    },
    cleanup: [],
    publicationBlocker: null,
  };
}
function previewReply(revision: number) {
  return {
    schema: 1,
    revision,
    review: token,
    root: "/project",
    deployment: { entries: [], canPublish: true, lock: null },
    isResuming: false,
    recoveryFiles: [],
    publicationBlocker: null,
  };
}
const report = {
  schema: 1,
  created: [".voktty/.gitignore", ".voktty/kit.json"],
  cleaned: [backup, ".voktty/.initialization.json"],
  skipped: [],
  migrated: [],
};
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
  invoke.mockImplementation(
    async (command: string, args?: { request?: { revision: number } }) => {
      if (command === "project_memory_open") return handle;
      if (command === "project_memory_select") return "original-selection";
      if (command === "project_memory_review_recovery")
        return reply(args?.request?.revision);
      if (command === "project_memory_preview")
        return previewReply(args?.request?.revision ?? 0);
      if (command === "project_memory_confirm_recovery") return report;
      if (command.startsWith("project_memory_cancel_")) return true;
    },
  );
});
async function setup() {
  const owner = createNativeMemoryPresentation();
  const selected = await owner.select(input.destination, input.environment);
  return { owner, selected };
}

it("accepts the bounded three-target inventory and copies only known native fields", async () => {
  const { owner, selected } = await setup();
  const data = {
    ...reply(),
    root: "C:\\work\\project",
    instructions: "unrelated",
    entries: [
      { ...reply().entries[0], text: "x".repeat(256 * 1024), extra: "discard" },
      {
        target: "AGENTS.md",
        backup: `.voktty-migration-${token}-3`,
        text: "agents",
        extra: "discard",
      },
      {
        target: "CLAUDE.md",
        backup: `.voktty-migration-${token}-4`,
        text: "claude",
        extra: "discard",
      },
    ],
  };
  invoke.mockResolvedValue(data);
  const accepted = await owner.reviewRecovery(selected, input);
  data.entries[0].text = "changed after delivery";
  data.digest = "b".repeat(64);
  expect(accepted.snapshot.root).toBe("C:\\work\\project");
  expect(accepted.snapshot.entries[0].text.length).toBe(256 * 1024);
  expect(accepted.snapshot).not.toHaveProperty("instructions");
  expect(accepted.snapshot.entries[0]).not.toHaveProperty("extra");
  invoke.mockResolvedValue({
    schema: 1,
    created: [
      ...accepted.snapshot.entries.map((entry) => entry.target),
      ".voktty/kit.json",
    ],
    cleaned: [
      ...accepted.snapshot.entries.map((entry) => entry.backup),
      ".voktty/.initialization.json",
    ],
    migrated: [],
    skipped: [],
  });
  await owner.confirmRecovery(selected, accepted);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_recovery", {
    handle,
    selection: "original-selection",
    confirmation: { review: token, digest: "a".repeat(64) },
  });
  await owner.close();
});

it("captures recovery input and freezes reviewed bytes while retaining token and digest privately", async () => {
  const { owner, selected } = await setup();
  const mutable = structuredClone(input);
  const pending = owner.reviewRecovery(selected, mutable);
  mutable.destination = "/replacement";
  const accepted = await pending;
  expect(invoke).toHaveBeenCalledWith("project_memory_review_recovery", {
    handle,
    selection: "original-selection",
    request: { ...input, revision: 1 },
  });
  expect(accepted.snapshot).toEqual({
    schema: 2,
    root: "/project",
    entries: reply().entries,
    deployment: { entries: reply().deployment.entries, canPublish: true },
    cleanup: [],
    publicationBlocker: null,
  });
  expect(accepted.snapshot).not.toHaveProperty("digest");
  expect(accepted.snapshot).not.toHaveProperty("review");
  expect(Object.isFrozen(accepted.snapshot.entries[0])).toBe(true);
  expect(Object.isFrozen(accepted.snapshot.entries)).toBe(true);
  expect(Object.isFrozen(accepted.snapshot)).toBe(true);
  expect(await owner.confirmRecovery(selected, accepted)).toEqual(report);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_recovery", {
    handle,
    selection: "original-selection",
    confirmation: { review: token, digest: "a".repeat(64) },
  });
  await expect(owner.confirmRecovery(selected, accepted)).rejects.toMatchObject(
    { code: "cancelled" },
  );
  await owner.close();
});

it("shares deployment revisions and rejects cross-operation, foreign, copied and superseded receipts", async () => {
  const { owner, selected } = await setup();
  const other = await setup();
  const first = await owner.preview(selected, previewInput);
  const accepted = await owner.reviewRecovery(selected, input);
  expect(owner.isReviewCurrent(selected, first)).toBe(false);
  expect(await owner.cancelPreview(selected)).toBe(false);
  const foreign = await other.owner.reviewRecovery(other.selected, input);
  for (const value of [
    foreign,
    { ...accepted },
    first as unknown as NativeMemoryRecoveryReview,
  ])
    await expect(owner.confirmRecovery(selected, value)).rejects.toMatchObject({
      code: "cancelled",
    });
  await expect(
    owner.confirmPreview(selected, accepted as unknown as NativeMemoryReview),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(owner.isRecoveryReviewCurrent(selected, accepted)).toBe(true);
  const fresh = await owner.preview(selected, previewInput);
  expect(owner.isRecoveryReviewCurrent(selected, accepted)).toBe(false);
  expect(await owner.cancelRecovery(selected)).toBe(false);
  expect(owner.isReviewCurrent(selected, fresh)).toBe(true);
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_review_recovery",
    )[0][1].request.revision,
  ).toBe(2);
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_preview",
    )[1][1].request.revision,
  ).toBe(3);
  await owner.close();
  await other.owner.close();
});

it.each([false, true])(
  "suppresses late recovery result or error after a newer publication (%s)",
  async (reject) => {
    const { owner, selected } = await setup();
    const read = deferred<ReturnType<typeof reply>>();
    const started = deferred<void>();
    invoke.mockImplementation(async (command: string) => {
      if (command === "project_memory_review_recovery") {
        started.resolve();
        return read.promise;
      }
      if (command === "project_memory_preview") return previewReply(2);
    });
    const pending = owner.reviewRecovery(selected, input);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await started.promise;
    const current = await owner.preview(selected, previewInput);
    if (reject) read.reject({ code: "unavailable" });
    else read.resolve(reply());
    await rejected;
    expect(owner.isReviewCurrent(selected, current)).toBe(true);
    await owner.close();
  },
);

it("cancels before dispatch without admitting a read and coalesces retryable cancellation", async () => {
  const { owner, selected } = await setup();
  const pending = owner.reviewRecovery(selected, input);
  const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await owner.cancelRecovery(selected);
  await rejected;
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_review_recovery",
    ),
  ).toHaveLength(0);
  const accepted = await owner.reviewRecovery(selected, input);
  const cancellation = deferred<boolean>();
  invoke.mockImplementation(async (command: string) =>
    command === "project_memory_cancel_recovery"
      ? cancellation.promise
      : undefined,
  );
  const first = owner.cancelRecovery(selected);
  expect(owner.cancelRecovery(selected)).toBe(first);
  const failed = expect(first).rejects.toMatchObject({ code: "unavailable" });
  cancellation.reject({ code: "unavailable" });
  await failed;
  expect(owner.isRecoveryReviewCurrent(selected, accepted)).toBe(false);
  invoke.mockResolvedValue(true);
  expect(await owner.cancelRecovery(selected)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_cancel_recovery", {
    handle,
    selection: "original-selection",
    revision: 2,
  });
  await owner.close();
});

it.each([false, true])(
  "coalesces confirmation through actual settlement and consumes success or partial failure (%s)",
  async (fail) => {
    const { owner, selected } = await setup();
    const accepted = await owner.reviewRecovery(selected, input);
    const write = deferred<typeof report>();
    const started = deferred<void>();
    invoke.mockImplementation(async (command: string) => {
      if (command === "project_memory_confirm_recovery") {
        started.resolve();
        return write.promise;
      }
    });
    const pending = owner.confirmRecovery(selected, accepted);
    expect(owner.confirmRecovery(selected, accepted)).toBe(pending);
    const failure = {
      code: "recoveryRequired",
      changes: {
        created: [".voktty/.gitignore"],
        migrated: [],
        cleaned: [backup],
        possibleRecoveryFiles: [backup],
      },
    };
    const settled = fail
      ? expect(pending).rejects.toBe(failure)
      : expect(pending).resolves.toEqual(report);
    await started.promise;
    if (fail) write.reject(failure);
    else write.resolve(report);
    await settled;
    await expect(
      owner.confirmRecovery(selected, accepted),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "project_memory_confirm_recovery",
      ),
    ).toHaveLength(1);
    await owner.close();
  },
);

it.each(["select", "close"] as const)(
  "suppresses a confirmation after original owner retirement (%s)",
  async (retirement) => {
    const { owner, selected } = await setup();
    const accepted = await owner.reviewRecovery(selected, input);
    const write = deferred<typeof report>();
    const started = deferred<void>();
    invoke.mockImplementation(async (command: string) => {
      if (command === "project_memory_confirm_recovery") {
        started.resolve();
        return write.promise;
      }
      if (command === "project_memory_select") return "replacement";
    });
    const pending = owner.confirmRecovery(selected, accepted);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    await started.promise;
    if (retirement === "select")
      await owner.select(input.destination, input.environment);
    else await owner.close();
    write.resolve(report);
    await rejected;
    await owner.close();
  },
);

const malformed = [
  (r: Record<string, unknown>) => {
    r.deployment = {
      ...reply().deployment,
      entries: [
        {
          ...reply().deployment.entries[0],
          path: ".voktty/state/settings.json",
        },
      ],
    };
  },
  (r: Record<string, unknown>) => {
    r.deployment = {
      ...reply().deployment,
      entries: [{ ...reply().deployment.entries[0], path: ".voktty/../.env" }],
    };
  },
  (r: Record<string, unknown>) => {
    r.deployment = {
      ...reply().deployment,
      entries: [{ ...reply().deployment.entries[0], action: "migrate" }],
    };
  },
  (r: Record<string, unknown>) => {
    r.deployment = {
      ...reply().deployment,
      entries: [
        reply().deployment.entries[0],
        { ...reply().deployment.entries[0], path: ".voktty/KIT.json" },
      ],
    };
  },
  (r: Record<string, unknown>) => {
    r.cleanup = [{ path: ".env", text: "private" }];
  },
  (r: Record<string, unknown>) => {
    r.cleanup = [
      {
        path: ".voktty/.voktty-migration-abcdefab-1234-4234-8234-123456789abc-3",
        text: "foreign transaction",
      },
    ];
  },
  (r: Record<string, unknown>) => {
    r.schema = 1;
  },
  (r: Record<string, unknown>) => {
    r.revision = 2;
  },
  (r: Record<string, unknown>) => {
    r.review = "bad";
  },
  (r: Record<string, unknown>) => {
    r.digest = "b".repeat(65);
  },
  (r: Record<string, unknown>) => {
    r.root = "bad\nroot";
  },
  (r: Record<string, unknown>) => {
    r.root = "\ud800";
  },
  (r: Record<string, unknown>) => {
    r.root = "é".repeat(2049);
  },
  (r: Record<string, unknown>) => {
    r.deployment = { ...reply().deployment, entries: [] };
  },
  (r: Record<string, unknown>) => {
    r.entries = [reply().entries[0], reply().entries[0]];
  },
  (r: Record<string, unknown>) => {
    r.entries = [{ ...reply().entries[0], target: ".env" }];
  },
  (r: Record<string, unknown>) => {
    r.entries = [{ ...reply().entries[0], backup: `../${backup}` }];
  },
  (r: Record<string, unknown>) => {
    r.entries = [
      {
        ...reply().entries[0],
        backup: `.voktty/.voktty-migration-${token}-128`,
      },
    ];
  },
  (r: Record<string, unknown>) => {
    r.entries = [{ ...reply().entries[0], text: "é".repeat(131073) }];
  },
  (r: Record<string, unknown>) => {
    r.entries = [
      reply().entries[0],
      {
        target: "AGENTS.md",
        backup: `.voktty-migration-${token}-2`,
        text: "rules",
      },
    ];
  },
  (r: Record<string, unknown>) => {
    r.entries = Array.from({ length: 4 }, () => reply().entries[0]);
  },
  (r: Record<string, unknown>) => {
    r.entries = [
      reply().entries[0],
      {
        target: "AGENTS.md",
        backup: ".voktty-migration-abcdefab-1234-4234-8234-123456789abc-3",
        text: "rules",
      },
    ];
  },
];
it("accepts project completion without missing originals and verifies cleanup multiplicity", () => {
  const data = {
    ...reply(),
    entries: [],
    cleanup: [
      { path: backup, text: "proposal" },
      { path: backup, text: "original" },
    ],
  };
  const { receipt } = memoryRecoveryReview(data, 1);
  const completed = {
    schema: 1,
    created: [".voktty/kit.json"],
    cleaned: [backup, ".voktty/.initialization.json", backup],
    migrated: [],
    skipped: [],
  };
  expect(memoryRestorationReport(completed, receipt)).toEqual(completed);
  expect(() =>
    memoryRestorationReport(
      { ...completed, cleaned: [backup, ".voktty/.initialization.json"] },
      receipt,
    ),
  ).toThrow();
  data.cleanup[0].text = "changed after review";
  expect(receipt.snapshot.cleanup[0].text).toBe("proposal");
  expect(Object.isFrozen(receipt.snapshot.deployment.entries[0])).toBe(true);
});
it.each(malformed.map((change, index) => ({ change, index })))(
  "rejects invalid review wire data before acceptance ($index)",
  async ({ change }) => {
    const { owner, selected } = await setup();
    const data = reply();
    change(data);
    invoke.mockResolvedValue(data);
    await expect(owner.reviewRecovery(selected, input)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "project_memory_confirm_recovery",
      ),
    ).toHaveLength(0);
    await owner.close();
  },
);

it.each(["created", "cleaned", "skipped", "migrated"] as const)(
  "rejects mismatched restoration reports without restoring acceptance (%s)",
  async (field) => {
    const { owner, selected } = await setup();
    const accepted = await owner.reviewRecovery(selected, input);
    invoke.mockResolvedValue({ ...report, [field]: ["foreign"] });
    await expect(
      owner.confirmRecovery(selected, accepted),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      owner.confirmRecovery(selected, accepted),
    ).rejects.toMatchObject({ code: "cancelled" });
    await owner.close();
  },
);

it("counts retired recovery reads against the shared budget and preserves admitted recovery on rejection", async () => {
  const { owner, selected } = await setup();
  const held = deferred<void>();
  let started = deferred<void>();
  invoke.mockImplementation(
    async (command: string, args?: { request?: { revision: number } }) => {
      if (command === "project_memory_review_recovery") {
        started.resolve();
        await held.promise;
        return reply(args?.request?.revision);
      }
    },
  );
  const retired: Promise<unknown>[] = [];
  for (let index = 0; index < 256; index += 1) {
    started = deferred<void>();
    retired.push(
      owner.reviewRecovery(selected, input).catch((error: unknown) => error),
    );
    await started.promise;
  }
  await expect(owner.preview(selected, previewInput)).rejects.toMatchObject({
    code: "busy",
  });
  await expect(owner.reviewRecovery(selected, input)).rejects.toMatchObject({
    code: "busy",
  });
  held.resolve();
  const results = await Promise.all(retired);
  const current = results[255] as NativeMemoryRecoveryReview;
  expect(owner.isRecoveryReviewCurrent(selected, current)).toBe(true);
  expect(
    results
      .slice(0, 255)
      .every((value) => (value as { code?: string }).code === "cancelled"),
  ).toBe(true);
  await owner.close();
});
