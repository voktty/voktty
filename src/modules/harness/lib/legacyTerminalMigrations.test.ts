import { expect, it, vi } from "vitest";
import {
  createHarnessWindowViews,
  type HarnessWindowViewInput,
} from "@/modules/harness/lib/harnessWindowViews";
import { createLegacyTerminalMigrations } from "@/modules/harness/lib/legacyTerminalMigrations";
import {
  newTerminalFile,
  newTerminalWorkspaceTab,
  type FilePaneTab,
} from "@/modules/harness/lib/layout";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

function fixture(
  file = newTerminalFile("remote://build/srv/app/src", "Build"),
) {
  const tab = newTerminalWorkspaceTab(file);
  const input: HarnessWindowViewInput = {
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: "remote://build/srv/app",
    projectTerminals: [],
    projectReturnMemory: new Map(),
    report: {
      referencedSessionIds: [],
      foregroundSessionIds: [],
      activeSessionId: null,
    },
  };
  return { file, tab, input };
}
const reference = {
  tabKey: asTabKey("tab-canonical-build"),
  projectCwd: "remote://build/srv/app",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("atomically converts active and retained cohorts before notifying snapshot readers", () => {
  const views = createHarnessWindowViews();
  const { input, file, tab } = fixture();
  const active = views.register(1, input);
  const retained = views.register(2, input);
  retained.release();
  const snapshots: unknown[] = [];
  views.subscribe(() => snapshots.push(views.capture([])));
  expect(views.migrateTerminal(file, reference, () => true)).toBe(true);
  expect(snapshots).toHaveLength(1);
  for (const cohort of views.getSnapshot().cohorts) {
    expect(cohort.state.layout.tabs[0].filePanes[0].files[0]).toEqual({
      ...file,
      canonicalTerminal: reference,
    });
    expect(cohort.state.layout.tabs[0].layout).toEqual(tab.layout);
    expect(cohort.state.layout.tabs[0].focusedId).toBe(tab.focusedId);
  }
  active.update(input);
  expect(
    views.capture([]).tabs[0].filePanes[0].files[0].canonicalTerminal,
  ).toEqual(reference);
  const cohort = views.getSnapshot().cohorts.find((entry) => !entry.active);
  expect(cohort).toBeDefined();
  if (!cohort) throw new Error("Missing retained cohort");
  expect(views.restore(3, cohort)?.isCurrent()).toBe(true);
  views.register(4, input);
  expect(
    views.capture([]).tabs[0].filePanes[0].files[0].canonicalTerminal,
  ).toEqual(reference);
});

it("converts closed dock files and inactive panes while preserving selection, geometry and unrelated files", () => {
  const { input, file, tab } = fixture();
  const other: FilePaneTab = { id: "editor", cwd: file.cwd, path: "notes.txt" };
  tab.filePanes[0].files.push(other);
  tab.filePanes[0].activeFileId = other.id;
  input.projectTerminals = [
    {
      projectPath: input.projectCwd,
      side: "right",
      size: 350,
      open: false,
      pane: { id: "dock", files: [file], activeFileId: file.id },
    },
  ];
  const views = createHarnessWindowViews();
  views.register(1, input);
  views.migrateTerminal(file, reference, () => true);
  const mapped = views.normalizeTerminals(input.tabs, input.projectTerminals);
  expect(mapped.tabs[0].filePanes[0].activeFileId).toBe(other.id);
  expect(mapped.tabs[0].filePanes[0].files[1]).toBe(other);
  expect(mapped.docks[0]).toMatchObject({
    side: "right",
    size: 350,
    open: false,
    pane: { activeFileId: file.id },
  });
  expect(mapped.docks[0].pane.files[0].canonicalTerminal).toEqual(reference);
  expect(views.normalizeTerminals(mapped.tabs, mapped.docks)).toEqual(mapped);
});

it("refuses conflicting aliases without publishing a partial conversion", () => {
  const { input, file } = fixture();
  const views = createHarnessWindowViews();
  views.register(1, input);
  const before = views.getSnapshot();
  expect(() =>
    views.migrateTerminal({ ...file, cwd: "/other" }, reference, () => true),
  ).toThrow("Conflicting");
  expect(views.getSnapshot()).toBe(before);
  expect(views.normalizeTerminals(input.tabs, []).tabs).toBe(input.tabs);
});

it("checks authority again before publishing and rejects stale canonical replacements", () => {
  const { input, file } = fixture();
  const views = createHarnessWindowViews();
  views.register(1, input);
  const before = views.getSnapshot();
  let checks = 0;
  expect(views.migrateTerminal(file, reference, () => ++checks === 1)).toBe(
    false,
  );
  expect(views.getSnapshot()).toBe(before);
  views.migrateTerminal(file, reference, () => true);
  const replacement = { ...reference, tabKey: asTabKey("tab-recovered") };
  expect(() => views.migrateTerminal(file, replacement, () => true)).toThrow(
    "superseded",
  );
  views.migrateTerminal(
    { ...file, canonicalTerminal: reference },
    replacement,
    () => true,
  );
  expect(
    views.normalizeTerminals(input.tabs, []).tabs[0].filePanes[0].files[0]
      .canonicalTerminal,
  ).toEqual(replacement);
});

it("coalesces canonical creation and retains its accepted result for a later owner", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const pending = deferred<{ tabKey: typeof reference.tabKey }>();
  const service = createLegacyTerminalMigrations(views);
  const create = vi.fn(() => pending.promise);
  const first = service.run(file, input.projectCwd, () => true, create);
  expect(service.run({ ...file }, input.projectCwd, () => true, create)).toBe(
    first,
  );
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(views.capture([]).tabs[0].filePanes[0].files[0]).toEqual(file);
  pending.resolve({ tabKey: reference.tabKey });
  await expect(first).resolves.toEqual({ tabKey: reference.tabKey });
  expect(service.run(file, input.projectCwd, () => true, create)).toBe(first);
  expect(create).toHaveBeenCalledOnce();
});

it("preserves metadata after failed creation and allows a fresh retry", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const service = createLegacyTerminalMigrations(views);
  const failure = new Error("canonical creation failed");
  const create = vi
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue({ tabKey: reference.tabKey });
  const first = service.run(file, input.projectCwd, () => true, create, true);
  const joined = service.run(file, input.projectCwd, () => true, create);
  await expect(first).rejects.toBe(failure);
  await expect(joined).rejects.toBe(failure);
  expect(create).toHaveBeenCalledOnce();
  expect(views.capture([]).tabs[0].filePanes[0].files[0]).toEqual(file);
  await expect(
    service.run(file, input.projectCwd, () => true, create),
  ).resolves.toEqual({ tabKey: reference.tabKey });
  expect(create).toHaveBeenCalledTimes(2);
});

it("refuses conflicting definitions and revalidates project reservations before creation", async () => {
  let reserved = false;
  const views = createHarnessWindowViews(undefined, {
    has: () => reserved,
    owns: () => false,
  });
  const { input, file } = fixture();
  views.register(1, input);
  const service = createLegacyTerminalMigrations(views);
  const create = vi.fn();
  const result = service.run(file, input.projectCwd, () => true, create);
  const conflict = expect(
    service.run(file, "/other-project", () => true, create),
  ).rejects.toThrow("Conflicting");
  reserved = true;
  await Promise.all([conflict, expect(result).rejects.toThrow("reserved")]);
  expect(create).not.toHaveBeenCalled();
});

it("does not overwrite a cohort replaced reentrantly during the final authority check", () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const replacement = fixture(newTerminalFile("/other", "Other"));
  let checks = 0;
  const current = () => {
    if (++checks === 2) views.register(1, replacement.input);
    return true;
  };
  expect(views.migrateTerminal(file, reference, current)).toBe(false);
  expect(views.capture([]).tabs[0].id).toBe(replacement.tab.id);
  expect(views.normalizeTerminals(input.tabs, []).tabs).toBe(input.tabs);
});

it("refuses layout conversion when the project is reserved after creation was accepted", () => {
  let reserved = false;
  const views = createHarnessWindowViews(undefined, {
    has: () => reserved,
    owns: () => false,
  });
  const { file, input } = fixture();
  views.register(1, input);
  const before = views.getSnapshot();
  let checks = 0;
  expect(
    views.migrateTerminal(file, reference, () => {
      if (++checks === 2) reserved = true;
      return true;
    }),
  ).toBe(false);
  expect(views.getSnapshot()).toBe(before);
  reserved = false;
  expect(views.migrateTerminal(file, reference, () => true)).toBe(true);
});

it("publishes the exact shared promise before a reentrant admission callback", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const service = createLegacyTerminalMigrations(views);
  const create = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  let reentered: Promise<unknown> | undefined;
  const result = service.run(
    file,
    input.projectCwd,
    () => {
      reentered = service.run(file, input.projectCwd, () => true, create);
      return true;
    },
    create,
  );
  await result;
  expect(reentered).toBe(result);
  expect(create).toHaveBeenCalledOnce();
});

it.each([
  "/srv/app",
  "C:/projects/app",
  "//server/share/app",
  "remote://voktty-ssh-build/srv/app",
])("preserves the host path and title when converting %s", (root) => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture(newTerminalFile(`${root}/src`, "Build Δ"));
  input.projectCwd = root;
  views.register(1, input);
  const target = { ...reference, projectCwd: root };
  views.migrateTerminal(file, target, () => true);
  expect(views.capture([]).tabs[0].filePanes[0].files[0]).toEqual({
    ...file,
    canonicalTerminal: target,
  });
});

it("bounds unsettled and accepted mappings without creating a 257th terminal", async () => {
  const views = createHarnessWindowViews();
  const pending = deferred<{ tabKey: typeof reference.tabKey }>();
  const service = createLegacyTerminalMigrations(views);
  const create = vi.fn(() => pending.promise);
  const files = Array.from({ length: 257 }, () =>
    newTerminalFile("/srv/app", "Build"),
  );
  const results = files
    .slice(0, 256)
    .map((file) => service.run(file, "/srv/app", () => true, create));
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(256));
  await expect(
    service.run(files[256], "/srv/app", () => true, create),
  ).rejects.toThrow("unavailable");
  pending.resolve({ tabKey: reference.tabKey });
  await Promise.all(results);
  expect(service.run(files[0], "/srv/app", () => true, create)).toBe(
    results[0],
  );
  expect(create).toHaveBeenCalledTimes(256);
  service.dispose();
  await expect(
    service.run(files[0], "/srv/app", () => true, create),
  ).rejects.toThrow("retired");
});

it("admits hidden metadata without a resource registry and retires candidate delivery on disposal", () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const service = createLegacyTerminalMigrations(views);
  expect(service.coldCandidates(input.projectCwd)).toEqual([file]);
  expect(service.canMigrateCold(file, input.projectCwd)).toBe(true);
  service.dispose();
  expect(service.coldCandidates(input.projectCwd)).toEqual([]);
  expect(service.canMigrateCold(file, input.projectCwd)).toBe(false);
});

it("keeps retired pending creations charged until their actual requests settle", async () => {
  const views = createHarnessWindowViews();
  const service = createLegacyTerminalMigrations(views);
  const pending = deferred<void>();
  let live = true;
  const create = vi.fn(async () => {
    await pending.promise;
    throw new Error("creation cancelled");
  });
  const requests = Array.from({ length: 256 }, () =>
    service.run(newTerminalFile("/srv/app"), "/srv/app", () => live, create),
  );
  const outcomes = Promise.allSettled(requests);
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(256));
  live = false;
  const next = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  await expect(
    service.run(newTerminalFile("/srv/app"), "/srv/app", () => true, next),
  ).rejects.toThrow("unavailable");
  expect(next).not.toHaveBeenCalled();
  pending.resolve();
  for (const outcome of await outcomes) {
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected")
      expect(outcome.reason.message).toBe("Terminal migration was retired.");
  }
  await expect(
    service.run(newTerminalFile("/srv/app"), "/srv/app", () => true, next),
  ).resolves.toEqual({ tabKey: reference.tabKey });
  expect(next).toHaveBeenCalledOnce();
});

it("retries retired cold admission only after its pending canonical creation settles", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const pending = deferred<void>();
  const service = createLegacyTerminalMigrations(views);
  let original = true;
  const oldCreate = vi.fn(() =>
    pending.promise.then(() => {
      throw new Error("cancelled");
    }),
  );
  const old = service.run(
    file,
    input.projectCwd,
    () => original,
    oldCreate,
    true,
  );
  const rejected = expect(old).rejects.toThrow("retired");
  await vi.waitFor(() => expect(oldCreate).toHaveBeenCalledOnce());
  original = false;
  const nextCreate = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  const next = service.run(file, input.projectCwd, () => true, nextCreate);
  expect(nextCreate).not.toHaveBeenCalled();
  pending.resolve();
  await rejected;
  await expect(next).resolves.toEqual({ tabKey: reference.tabKey });
  expect(oldCreate).toHaveBeenCalledOnce();
  expect(nextCreate).toHaveBeenCalledOnce();
});

it.each(["caller", "service"])(
  "retires %s admission before invoking canonical creation",
  async (reason) => {
    const views = createHarnessWindowViews();
    const { file, input } = fixture();
    views.register(1, input);
    const service = createLegacyTerminalMigrations(views);
    let live = true;
    const create = vi.fn();
    const result = service.run(file, input.projectCwd, () => live, create);
    if (reason === "caller") live = false;
    else service.dispose();
    await expect(result).rejects.toThrow("retired");
    expect(create).not.toHaveBeenCalled();
  },
);
