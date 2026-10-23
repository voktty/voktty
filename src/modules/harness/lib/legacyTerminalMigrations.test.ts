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
    expect(cohort.state.layout.tabs[0].terminalPanes[0].files[0]).toEqual({
      ...file,
      canonicalTerminal: reference,
    });
    expect(cohort.state.layout.tabs[0].layout).toEqual(tab.layout);
    expect(cohort.state.layout.tabs[0].focusedId).toBe(tab.focusedId);
  }
  active.update(input);
  expect(
    views.capture([]).tabs[0].terminalPanes[0].files[0].canonicalTerminal,
  ).toEqual(reference);
  const cohort = views.getSnapshot().cohorts.find((entry) => !entry.active);
  expect(cohort).toBeDefined();
  if (!cohort) throw new Error("Missing retained cohort");
  expect(views.restore(3, cohort)?.isCurrent()).toBe(true);
  views.register(4, input);
  expect(
    views.capture([]).tabs[0].terminalPanes[0].files[0].canonicalTerminal,
  ).toEqual(reference);
});

it("converts closed dock files and inactive panes while preserving selection, geometry and unrelated files", () => {
  const { input, file, tab } = fixture();
  const other: FilePaneTab = { id: "editor", cwd: file.cwd, path: "notes.txt" };
  tab.terminalPanes[0].files.push(other);
  tab.terminalPanes[0].activeFileId = other.id;
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
  expect(mapped.tabs[0].terminalPanes[0].activeFileId).toBe(other.id);
  expect(mapped.tabs[0].terminalPanes[0].files[1]).toBe(other);
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
    views.normalizeTerminals(input.tabs, []).tabs[0].terminalPanes[0].files[0]
      .canonicalTerminal,
  ).toEqual(replacement);
});

it("coalesces duplicate migrations, confirms before closing, and retains the accepted result for a later owner", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const confirmation = deferred<boolean>();
  const cleanup = deferred<void>();
  const close = vi.fn(() => cleanup.promise);
  const release = vi.fn();
  const capture = vi.fn(() => ({ close, release }));
  const confirm = vi.fn(() => confirmation.promise);
  const service = createLegacyTerminalMigrations(views, capture, confirm);
  const create = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  const first = service.run(file, input.projectCwd, () => true, create);
  expect(service.run({ ...file }, input.projectCwd, () => true, create)).toBe(
    first,
  );
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
  confirmation.resolve(true);
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(create).not.toHaveBeenCalled();
  cleanup.resolve();
  await expect(first).resolves.toEqual({ tabKey: reference.tabKey });
  expect(release).toHaveBeenCalledOnce();
  expect(service.run(file, input.projectCwd, () => true, create)).toBe(first);
  expect(create).toHaveBeenCalledOnce();
});

it("preserves the original terminal when confirmation is declined and retries later", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const close = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const service = createLegacyTerminalMigrations(
    views,
    () => ({ close, release }),
    confirm,
  );
  const create = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  await expect(
    service.run(file, input.projectCwd, () => true, create),
  ).rejects.toThrow("declined");
  expect(close).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(
    views.capture([]).tabs[0].terminalPanes[0].files[0].canonicalTerminal,
  ).toBeUndefined();
  await service.run(file, input.projectCwd, () => true, create);
  expect(close).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
});

it("releases the migration fence and preserves layout after failed cleanup or retired authority", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const close = vi
    .fn()
    .mockRejectedValueOnce(new Error("native cleanup failed"))
    .mockResolvedValue(undefined);
  const release = vi.fn();
  let live = true;
  const service = createLegacyTerminalMigrations(
    views,
    () => ({ close, release }),
    async () => true,
  );
  const create = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  await expect(
    service.run(file, input.projectCwd, () => live, create),
  ).rejects.toThrow("native cleanup failed");
  expect(release).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  close.mockImplementationOnce(async () => {
    live = false;
  });
  await expect(
    service.run(file, input.projectCwd, () => live, create),
  ).rejects.toThrow("retired");
  expect(create).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(2);
});

it("refuses a conflicting in-flight definition and revalidates project reservations after confirmation", async () => {
  let reserved = false;
  const views = createHarnessWindowViews(undefined, {
    has: () => reserved,
    owns: () => false,
  });
  const { input, file } = fixture();
  views.register(1, input);
  const pending = deferred<boolean>();
  const close = vi.fn();
  const release = vi.fn();
  const confirm = vi.fn(() => pending.promise);
  const service = createLegacyTerminalMigrations(
    views,
    () => ({ close, release }),
    confirm,
  );
  const create = vi.fn();
  const result = service.run(file, input.projectCwd, () => true, create);
  await expect(
    service.run(file, "/other-project", () => true, create),
  ).rejects.toThrow("Conflicting");
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  reserved = true;
  pending.resolve(true);
  await expect(result).rejects.toThrow("reserved");
  expect(close).not.toHaveBeenCalled();
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
  const close = vi.fn().mockResolvedValue(undefined);
  const service = createLegacyTerminalMigrations(
    views,
    () => ({ close, release: vi.fn() }),
    async () => true,
  );
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
  expect(close).toHaveBeenCalledOnce();
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
  expect(views.capture([]).tabs[0].terminalPanes[0].files[0]).toEqual({
    ...file,
    canonicalTerminal: target,
  });
});

it("bounds unsettled and accepted mappings without creating a 257th terminal", async () => {
  const views = createHarnessWindowViews();
  const pending = deferred<{ tabKey: typeof reference.tabKey }>();
  const close = vi.fn().mockResolvedValue(undefined);
  const capture = vi.fn(() => ({ close, release: vi.fn() }));
  const service = createLegacyTerminalMigrations(
    views,
    capture,
    async () => true,
  );
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
  expect(capture).toHaveBeenCalledTimes(256);
  service.dispose();
  await expect(
    service.run(files[0], "/srv/app", () => true, create),
  ).rejects.toThrow("retired");
});

it("creates cold metadata only from an empty capture without querying foreground processes", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const capture = vi.fn(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  }));
  const confirm = vi.fn().mockResolvedValue(true);
  let liveResource = false;
  const service = createLegacyTerminalMigrations(
    views,
    capture,
    confirm,
    () => liveResource,
  );
  expect(
    service.coldCandidates(input.projectCwd).map((file) => file.id),
  ).toEqual([file.id]);
  liveResource = true;
  expect(service.coldCandidates(input.projectCwd)).toEqual([]);
  expect(service.canMigrateCold(file, input.projectCwd)).toBe(false);
  const create = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  await expect(
    service.run(file, input.projectCwd, () => true, create, true),
  ).rejects.toThrow("foreground");
  expect(capture).not.toHaveBeenCalled();
  liveResource = false;
  await service.run(file, input.projectCwd, () => true, create, true);
  expect(capture).toHaveBeenCalledExactlyOnceWith(file.id, true);
  expect(create).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});

it("lets a current caller replace a retired cold admission after its exact cleanup settles", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const pending = deferred<void>();
  const close = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(undefined);
  const capture = vi.fn(() => ({ close, release: vi.fn() }));
  const confirm = vi.fn().mockResolvedValue(true);
  const service = createLegacyTerminalMigrations(
    views,
    capture,
    confirm,
    () => false,
  );
  let original = true;
  const oldCreate = vi.fn();
  const old = service.run(
    file,
    input.projectCwd,
    () => original,
    oldCreate,
    true,
  );
  const rejected = expect(old).rejects.toThrow("retired");
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  original = false;
  const nextCreate = vi.fn().mockResolvedValue({ tabKey: reference.tabKey });
  const next = service.run(file, input.projectCwd, () => true, nextCreate);
  expect(nextCreate).not.toHaveBeenCalled();
  pending.resolve();
  await rejected;
  await expect(next).resolves.toEqual({ tabKey: reference.tabKey });
  expect(oldCreate).not.toHaveBeenCalled();
  expect(nextCreate).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledOnce();
  expect(capture).toHaveBeenCalledTimes(2);
});

it("does not retry an actual cold cleanup failure through a joined caller", async () => {
  const views = createHarnessWindowViews();
  const { file, input } = fixture();
  views.register(1, input);
  const failure = new Error("native cleanup failed");
  const close = vi.fn().mockRejectedValue(failure);
  const capture = vi.fn(() => ({ close, release: vi.fn() }));
  const service = createLegacyTerminalMigrations(
    views,
    capture,
    async () => true,
    () => false,
  );
  const create = vi.fn();
  const old = service.run(file, input.projectCwd, () => true, create, true);
  const joined = service.run(file, input.projectCwd, () => true, create);
  await expect(old).rejects.toBe(failure);
  await expect(joined).rejects.toBe(failure);
  expect(capture).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
});
