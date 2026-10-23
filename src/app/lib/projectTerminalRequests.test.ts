import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createProjectTerminalRequests,
  type ProjectTerminalRequestContext,
} from "@/app/lib/projectTerminalRequests";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import type { ProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const uri = "remote://voktty-ssh-build/srv/app";
let current: boolean;
let context: ProjectTerminalRequestContext;
let target: ProjectTerminalTarget;
let resolve: ReturnType<
  typeof vi.fn<(cwd: string) => Promise<ProjectTerminalTarget | undefined>>
>;
let service: ReturnType<typeof createProjectTerminalRequests>;
beforeEach(() => {
  current = true;
  context = {
    isCurrent: () => current,
    create: vi.fn().mockReturnValue({ tabId: 11, leafId: 1 }),
    rollback: vi.fn(),
    pick: vi.fn().mockResolvedValue(null),
    cancelPicker: vi.fn(),
    onError: vi.fn(),
  };
  target = {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    lease: {
      info: {
        session_id: 7,
        workspace_root: "/srv/app",
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
  await ownedPtyTargets.close(1);
  await ownedPtyTargets.close(2);
  service.retryCleanup();
  await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
});

it("creates a canonical terminal with the resolved environment and transfers its own lease", async () => {
  await service.open(uri);
  expect(context.create).toHaveBeenCalledExactlyOnceWith(
    "/srv/app",
    target.workspace,
  );
  expect(ownedPtyTargets.get(1)?.isCurrent()).toBe(true);
  expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
  service.dispose();
  expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
  await ownedPtyTargets.close(1);
  expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it("keeps local terminal requests synchronous and off the remote loader", async () => {
  const pending = service.open("C:/work/app");
  expect(context.create).toHaveBeenCalledExactlyOnceWith("C:/work/app", {
    kind: "local",
  });
  expect(resolve).not.toHaveBeenCalled();
  await pending;
});

it.each(["selection", "dispose"])(
  "cleans late connection results after %s without creating or publishing errors",
  async (reason) => {
    const pending = deferred<ProjectTerminalTarget>();
    resolve.mockReturnValueOnce(pending.promise);
    const opening = service.open(uri);
    if (reason === "selection") current = false;
    else service.dispose();
    pending.resolve(target);
    await opening;
    expect(context.create).not.toHaveBeenCalled();
    expect(context.onError).not.toHaveBeenCalled();
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
  },
);

it("captures callbacks before awaiting instead of creating through a replacement callback", async () => {
  const pending = deferred<ProjectTerminalTarget>();
  resolve.mockReturnValueOnce(pending.promise);
  const originalCreate = context.create;
  const opening = service.open(uri);
  context.create = vi.fn().mockReturnValue({ tabId: 22, leafId: 2 });
  pending.resolve(target);
  await opening;
  expect(originalCreate).toHaveBeenCalledOnce();
  expect(context.create).not.toHaveBeenCalled();
});

it("rolls back only the just-created tab if target registration fails", async () => {
  service = createProjectTerminalRequests({
    capture: () => context,
    resolve,
    register: () => {
      throw new Error("registration failed");
    },
  });
  await service.open(uri);
  expect(context.rollback).toHaveBeenCalledExactlyOnceWith(11);
  expect(context.onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "registration failed" }),
  );
  expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it("rolls back reentrant creation retirement before registering any transport", async () => {
  vi.mocked(context.create).mockImplementation(() => {
    current = false;
    return { tabId: 11, leafId: 1 };
  });
  await service.open(uri);
  expect(context.rollback).toHaveBeenCalledExactlyOnceWith(11);
  expect(ownedPtyTargets.get(1)).toBeUndefined();
  expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
  expect(context.onError).not.toHaveBeenCalled();
});

it("retains failed cleanup and retries the original lease", async () => {
  const release = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined)
    .mockRejectedValueOnce(new Error("cleanup failed"));
  target.lease.releaseAndClose = release;
  const pending = deferred<ProjectTerminalTarget>();
  resolve.mockReturnValueOnce(pending.promise);
  const opening = service.open(uri);
  current = false;
  pending.resolve(target);
  await opening;
  expect(service.pendingCount()).toBe(1);
  service.retryCleanup();
  await vi.waitFor(() => expect(service.pendingCount()).toBe(0));
  expect(release).toHaveBeenCalledTimes(2);
  expect(context.onError).not.toHaveBeenCalled();
});

it("does not offer a picker after retirement or report user cancellation as failure", async () => {
  const picker = vi.fn().mockResolvedValue(null);
  context.pick = picker;
  service = createProjectTerminalRequests({
    capture: () => context,
    resolve: async (_cwd, choose) => {
      await choose(target.workspace.connection, {
        supported: true,
        sessions: [],
      });
      throw new Error("cancelled");
    },
  });
  await service.open(uri);
  expect(picker).toHaveBeenCalledOnce();
  expect(context.onError).not.toHaveBeenCalled();
  expect(context.create).not.toHaveBeenCalled();
});

it("keeps pending requests counted across disposal and never exceeds the window budget", async () => {
  const pending = deferred<ProjectTerminalTarget | undefined>();
  resolve.mockReturnValue(pending.promise);
  const openings = Array.from({ length: 256 }, () => service.open(uri));
  expect(service.pendingCount()).toBe(256);
  await service.open(uri);
  expect(resolve).toHaveBeenCalledTimes(256);
  service.dispose();
  expect(service.pendingCount()).toBe(256);
  pending.resolve(undefined);
  await Promise.all(openings);
  expect(service.pendingCount()).toBe(0);
});

it.each([
  { name: "non-string", cwd: 42 },
  { name: "oversized", cwd: "x".repeat(32769) },
  { name: "NUL", cwd: "bad\0folder" },
])(
  "rejects invalid $name folder input without creating resources",
  async ({ cwd }) => {
    await service.open(cwd);
    expect(context.onError).toHaveBeenCalledOnce();
    expect(context.create).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  },
);
