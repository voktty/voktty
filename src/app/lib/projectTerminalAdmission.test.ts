import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createProjectTerminalRequests,
  type ProjectTerminalRequestContext,
} from "@/app/lib/projectTerminalRequests";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import type { ProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";

const project = "remote://voktty-ssh-build/srv/app";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let context: ProjectTerminalRequestContext;
let target: ProjectTerminalTarget;
let service: ReturnType<typeof createProjectTerminalRequests>;
let resolve: ReturnType<
  typeof vi.fn<(cwd: string) => Promise<ProjectTerminalTarget | undefined>>
>;
beforeEach(() => {
  context = {
    isCurrent: () => true,
    create: vi.fn().mockReturnValue({ tabId: 1, leafId: 2 }),
    rollback: vi.fn(),
    pick: vi.fn().mockResolvedValue(null),
    cancelPicker: vi.fn(),
    onError: vi.fn(),
  };
  target = {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/canonical/app",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    lease: {
      info: {
        session_id: 7,
        workspace_root: "/canonical/app",
        architecture: "x86_64",
        helper_version: "test",
        capabilities: [],
      },
      release: vi.fn(),
      releaseAndClose: vi.fn().mockResolvedValue(undefined),
    },
  };
  resolve = vi.fn().mockResolvedValue(target);
  service = createProjectTerminalRequests({ capture: () => context, resolve });
});
afterEach(async () => {
  service.dispose();
  await ownedPtyTargets.close(2);
  service.retryCleanup();
  await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
});

it("confirms synchronously after registering the exact resource, allowing the view to restore focus", async () => {
  const onCreated = vi.fn(() => {
    expect(ownedPtyTargets.get(2)?.isCurrent()).toBe(true);
    expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
  });
  expect(await service.open(project, { onCreated })).toEqual({
    tabId: 1,
    leafId: 2,
  });
  expect(onCreated).toHaveBeenCalledExactlyOnceWith({ tabId: 1, leafId: 2 });
});

it("resolves the original project and opens the requested leaf folder under that lease", async () => {
  await service.open(`${project}/src`, { projectCwd: project });
  expect(resolve).toHaveBeenCalledWith(
    project,
    expect.any(Function),
    expect.any(Function),
  );
  expect(context.create).toHaveBeenCalledExactlyOnceWith(
    "/srv/app/src",
    target.workspace,
    undefined,
  );
  const receipt = ownedPtyTargets.get(2);
  if (!receipt) throw new Error("Missing admitted target.");
  const start = vi.fn().mockResolvedValue({
    id: 90,
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  });
  await receipt.open(start, { onData: vi.fn() });
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: "/srv/app/src",
      workspace: expect.objectContaining({ root: "/canonical/app" }),
    }),
    expect.anything(),
  );
});

it("retires only the caller while retaining the original view and cleaning a late helper", async () => {
  const pending = deferred<ProjectTerminalTarget>();
  resolve.mockReturnValueOnce(pending.promise);
  let live = true;
  const onCreated = vi.fn();
  const onError = vi.fn();
  const opening = service.open(project, {
    isCurrent: () => live,
    onCreated,
    onError,
  });
  live = false;
  pending.resolve(target);
  expect(await opening).toBeUndefined();
  expect(context.create).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it("rolls back failed confirmation and retains failed exact cleanup for retry", async () => {
  const onError = vi.fn();
  const release = target.lease.releaseAndClose;
  if (!release) throw new Error("Missing acknowledged cleanup.");
  vi.mocked(release).mockRejectedValueOnce(new Error("cleanup failed"));
  expect(
    await service.open(project, {
      onCreated: () => {
        throw new Error("bind failed");
      },
      onError,
    }),
  ).toBeUndefined();
  expect(context.rollback).toHaveBeenCalledExactlyOnceWith(1);
  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "bind failed" }),
  );
  expect(context.onError).not.toHaveBeenCalled();
  expect(service.pendingCount()).toBe(1);
  expect(ownedPtyTargets.size()).toBe(1);
  service.retryCleanup();
  await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
  expect(target.lease.releaseAndClose).toHaveBeenCalledTimes(2);
});

it("captures the original caller callbacks and project before resolving", async () => {
  const pending = deferred<ProjectTerminalTarget>();
  resolve.mockReturnValueOnce(pending.promise);
  const original = vi.fn();
  const replacement = vi.fn();
  const options = {
    projectCwd: project,
    title: "Original build",
    onCreated: original,
    isCurrent: () => true,
  };
  const opening = service.open(`${project}/src`, options);
  options.projectCwd = "remote://voktty-ssh-other/another";
  options.title = "Replacement build";
  options.onCreated = replacement;
  options.isCurrent = () => false;
  pending.resolve(target);
  await opening;
  expect(original).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
  expect(context.create).toHaveBeenCalledWith(
    "/srv/app/src",
    target.workspace,
    "Original build",
  );
});

it("does not revoke an accepted terminal when its confirmation retires the source view", async () => {
  let live = true;
  const created = await service.open(project, {
    isCurrent: () => live,
    onCreated: () => {
      live = false;
    },
  });
  expect(created).toEqual({ tabId: 1, leafId: 2 });
  expect(ownedPtyTargets.get(2)?.isCurrent()).toBe(true);
  expect(context.rollback).not.toHaveBeenCalled();
  expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
});

it("confirms local creation before returning its promise and rolls it back if its caller retires during create", async () => {
  const created = vi.fn();
  const opening = service.open("C:/Work", { onCreated: created });
  expect(created).toHaveBeenCalledExactlyOnceWith({ tabId: 1, leafId: 2 });
  expect(await opening).toEqual({ tabId: 1, leafId: 2 });
  expect(resolve).not.toHaveBeenCalled();
  let live = true;
  vi.mocked(context.create).mockImplementationOnce(() => {
    live = false;
    return { tabId: 3, leafId: 4 };
  });
  created.mockClear();
  await service.open("/srv/app", { isCurrent: () => live, onCreated: created });
  expect(created).not.toHaveBeenCalled();
  expect(context.rollback).toHaveBeenCalledWith(3);
});

it("defaults an omitted local working directory to the captured project", async () => {
  await service.open(undefined, { projectCwd: "C:/Work/App" });
  expect(context.create).toHaveBeenCalledExactlyOnceWith(
    "C:/Work/App",
    { kind: "local" },
    undefined,
  );
  expect(resolve).not.toHaveBeenCalled();
});

it("cancels only the requesting picker and waits for its actual settlement", async () => {
  const controller = new AbortController();
  const pending = deferred<null>();
  vi.mocked(context.pick).mockReturnValueOnce(pending.promise);
  service = createProjectTerminalRequests({
    capture: () => context,
    resolve: async (_cwd, pick) => {
      await pick(target.workspace.connection, {
        supported: true,
        sessions: [],
      });
      return undefined;
    },
  });
  const opening = service.open(project, { signal: controller.signal });
  expect(context.pick).toHaveBeenCalledOnce();
  controller.abort();
  expect(context.cancelPicker).toHaveBeenCalledOnce();
  expect(service.pendingCount()).toBe(1);
  pending.resolve(null);
  await opening;
  expect(service.pendingCount()).toBe(0);
  expect(context.create).not.toHaveBeenCalled();
  expect(context.onError).not.toHaveBeenCalled();
});

it("does not let confirmation change the captured tab identity before rollback", async () => {
  await service.open(project, {
    onCreated: (created) => {
      expect(Reflect.set(created, "tabId", 99)).toBe(false);
      throw new Error("binding failed");
    },
  });
  expect(context.rollback).toHaveBeenCalledExactlyOnceWith(1);
  expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it.each([
  { projectCwd: "remote://user:password@host/app", cwd: project },
  { projectCwd: "/srv/app", cwd: project },
  { projectCwd: "/srv/app", cwd: "relative/app" },
  { projectCwd: project, cwd: "remote://voktty-ssh-other/srv/app" },
])(
  "rejects a malformed or cross-connection project before resolution: %#",
  async (input) => {
    const onError = vi.fn();
    await service.open(input.cwd, { projectCwd: input.projectCwd, onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(resolve).not.toHaveBeenCalled();
    expect(context.create).not.toHaveBeenCalled();
  },
);
