import { expect, it, vi } from "vitest";
import { createProjectTerminalRequests } from "@/app/lib/projectTerminalRequests";

function fixture() {
  const create = vi.fn().mockReturnValue({ tabId: 11, leafId: 12 });
  const rollback = vi.fn();
  const onError = vi.fn();
  const resolve = vi
    .fn()
    .mockRejectedValue(new Error("Cold metadata must not resolve SSH."));
  const register = vi.fn((): never => {
    throw new Error("Cold metadata must not register a native target.");
  });
  const pick = vi.fn();
  const service = createProjectTerminalRequests({
    capture: () => ({
      isCurrent: () => true,
      create,
      rollback,
      onError,
      pick,
      cancelPicker: vi.fn(),
    }),
    resolve,
    register,
  });
  return { service, create, rollback, onError, resolve, register, pick };
}

it("requires an explicit valid project before allocating cold metadata", async () => {
  const f = fixture();
  await f.service.open("/srv/app", { cold: true });
  expect(f.create).not.toHaveBeenCalled();
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.onError).toHaveBeenCalledOnce();
  f.service.dispose();
});

it.each([
  ["remote://voktty-ssh-%zz/srv/app", undefined],
  ["remote://voktty-ssh-build/srv/app", "remote://voktty-ssh-other/srv/app"],
  ["C:/work/app", "remote://voktty-ssh-build/srv/app"],
  ["relative/project", "/srv/app"],
])(
  "rejects invalid cold destination %# without falling back to a local terminal",
  async (projectCwd, cwd) => {
    const f = fixture();
    await f.service.open(cwd, { projectCwd, cold: true });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.register).not.toHaveBeenCalled();
    expect(f.pick).not.toHaveBeenCalled();
    expect(f.onError).toHaveBeenCalledOnce();
    f.service.dispose();
  },
);

it("rolls back a failed cold confirmation without native allocation or cleanup", async () => {
  const f = fixture();
  await f.service.open("remote://voktty-ssh-build/srv/app/src", {
    projectCwd: "remote://voktty-ssh-build/srv/app",
    cold: true,
    onCreated: () => {
      throw new Error("binding failed");
    },
  });
  expect(f.rollback).toHaveBeenCalledExactlyOnceWith(11);
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.register).not.toHaveBeenCalled();
  expect(f.service.pendingCount()).toBe(0);
  f.service.dispose();
});
