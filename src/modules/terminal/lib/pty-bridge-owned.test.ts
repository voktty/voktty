import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { disposePtyTarget, openPty } from "@/modules/terminal/lib/pty-bridge";
import {
  ownedPtyTargets,
  type OwnedPtyTarget,
} from "@/modules/terminal/lib/ownedPtyTargets";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function target(): OwnedPtyTarget {
  return {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    release: vi.fn().mockResolvedValue(undefined),
  };
}
beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) =>
    command === "remote_pty_open" ? 91 : undefined,
  );
});
afterEach(async () => {
  await ownedPtyTargets.close(1);
  expect(ownedPtyTargets.size()).toBe(0);
});

it("uses the registered target and keeps its lease until the exact native close acknowledgement", async () => {
  const source = target();
  const receipt = ownedPtyTargets.register(1, source);
  const session = await openPty(
    80,
    24,
    { onData: vi.fn() },
    "/wrong",
    false,
    undefined,
    1,
    { kind: "local" },
  );
  expect(invokeMock).toHaveBeenCalledWith(
    "remote_pty_open",
    expect.objectContaining({ sessionId: 7, cwd: "/srv/app" }),
  );
  expect(
    invokeMock.mock.calls.some(([command]) => command === "pty_open"),
  ).toBe(false);
  const nativeClose = deferred<void>();
  invokeMock.mockImplementation(async (command: string) =>
    command === "remote_pty_close" ? nativeClose.promise : undefined,
  );
  const closing = session.close();
  await vi.waitFor(() =>
    expect(invokeMock).toHaveBeenCalledWith("remote_pty_close", {
      sessionId: 7,
      ptyId: 91,
    }),
  );
  expect(receipt.isCurrent()).toBe(false);
  expect(source.release).not.toHaveBeenCalled();
  await session.write("retired\r");
  expect(
    invokeMock.mock.calls.some(([command]) => command === "remote_pty_write"),
  ).toBe(false);
  nativeClose.resolve();
  await closing;
  expect(source.release).toHaveBeenCalledOnce();
});

it("waits for a late native open and close after leaf disposal", async () => {
  const source = target();
  ownedPtyTargets.register(1, source);
  const nativeOpen = deferred<number>();
  invokeMock.mockImplementation(async (command: string) =>
    command === "remote_pty_open" ? nativeOpen.promise : undefined,
  );
  const opening = openPty(
    80,
    24,
    { onData: vi.fn() },
    undefined,
    false,
    undefined,
    1,
  );
  const retired = expect(opening).rejects.toThrow("retired");
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
  disposePtyTarget(1);
  expect(source.release).not.toHaveBeenCalled();
  nativeOpen.resolve(91);
  await retired;
  expect(invokeMock).toHaveBeenCalledWith("remote_pty_close", {
    sessionId: 7,
    ptyId: 91,
  });
  expect(source.release).toHaveBeenCalledOnce();
});

it("retries a rejected native close instead of releasing the helper or accepting a replacement", async () => {
  const source = target();
  const receipt = ownedPtyTargets.register(1, source);
  const session = await openPty(
    80,
    24,
    { onData: vi.fn() },
    undefined,
    false,
    undefined,
    1,
  );
  invokeMock.mockRejectedValueOnce(new Error("native close failed"));
  await expect(session.close()).rejects.toThrow("native close failed");
  expect(source.release).not.toHaveBeenCalled();
  expect(() => ownedPtyTargets.register(1, target())).toThrow("already owned");
  await receipt.close();
  expect(
    invokeMock.mock.calls.filter(([command]) => command === "remote_pty_close"),
  ).toHaveLength(2);
  expect(source.release).toHaveBeenCalledOnce();
});

it("retains a failed helper release and does not repeat an acknowledged native close", async () => {
  const source = target();
  vi.mocked(source.release).mockRejectedValueOnce(new Error("helper failed"));
  const receipt = ownedPtyTargets.register(1, source);
  const session = await openPty(
    80,
    24,
    { onData: vi.fn() },
    undefined,
    false,
    undefined,
    1,
  );
  await expect(session.close()).rejects.toThrow("helper failed");
  await receipt.close();
  expect(
    invokeMock.mock.calls.filter(([command]) => command === "remote_pty_close"),
  ).toHaveLength(1);
  expect(source.release).toHaveBeenCalledTimes(2);
});

it("keeps startup failure on its original target for retry without releasing the lease", async () => {
  const source = target();
  ownedPtyTargets.register(1, source);
  invokeMock.mockRejectedValueOnce(new Error("open failed"));
  await expect(
    openPty(80, 24, { onData: vi.fn() }, undefined, false, undefined, 1),
  ).rejects.toThrow("open failed");
  expect(source.release).not.toHaveBeenCalled();
  const session = await openPty(
    80,
    24,
    { onData: vi.fn() },
    undefined,
    false,
    undefined,
    1,
  );
  await session.close();
  expect(
    invokeMock.mock.calls.filter(([command]) => command === "remote_pty_open"),
  ).toHaveLength(2);
  expect(source.release).toHaveBeenCalledOnce();
});

it("an old session close cannot release a successor registered on the same leaf", async () => {
  ownedPtyTargets.register(1, target());
  const old = await openPty(
    80,
    24,
    { onData: vi.fn() },
    undefined,
    false,
    undefined,
    1,
  );
  await old.close();
  await ownedPtyTargets.close(1);
  const source = target();
  const next = ownedPtyTargets.register(1, source);
  const current = await openPty(
    80,
    24,
    { onData: vi.fn() },
    undefined,
    false,
    undefined,
    1,
  );
  await old.close();
  expect(next.isCurrent()).toBe(true);
  expect(source.release).not.toHaveBeenCalled();
  await current.close();
});

it("keeps a retired leaf fenced against reopening through an unowned workspace descriptor", async () => {
  ownedPtyTargets.register(1, target());
  const old = await openPty(
    80,
    24,
    { onData: vi.fn() },
    undefined,
    false,
    undefined,
    1,
  );
  await old.close();
  invokeMock.mockClear();
  await expect(
    openPty(
      80,
      24,
      { onData: vi.fn() },
      undefined,
      false,
      undefined,
      1,
      target().workspace,
    ),
  ).rejects.toThrow("retired");
  expect(invokeMock).not.toHaveBeenCalled();
});

it("does not let a duplicate leaf borrow the original project terminal's lease", async () => {
  const source = target();
  ownedPtyTargets.register(1, source);
  await expect(
    openPty(
      80,
      24,
      { onData: vi.fn() },
      source.cwd,
      false,
      undefined,
      2,
      source.workspace,
    ),
  ).rejects.toThrow("own project connection");
  expect(invokeMock).not.toHaveBeenCalled();
  await ownedPtyTargets.close(1);
  await expect(
    openPty(
      80,
      24,
      { onData: vi.fn() },
      source.cwd,
      false,
      undefined,
      1,
      source.workspace,
    ),
  ).rejects.toThrow("own project connection");
});
