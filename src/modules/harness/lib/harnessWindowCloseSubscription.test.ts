import { expect, it, vi } from "vitest";
import { ownHarnessWindowCloseSubscription } from "./harnessWindowCloseSubscription";

type CloseEvent = { preventDefault: () => void };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function registration() {
  const pending = deferred<() => void>();
  let listener: ((event: CloseEvent) => void) | undefined;
  const register = vi.fn((callback: (event: CloseEvent) => void) => {
    listener = callback;
    return pending.promise;
  });
  return {
    register,
    pending,
    event: () => {
      if (!listener) throw new Error("Expected native close registration.");
      const event = { preventDefault: vi.fn() };
      listener(event);
      return event;
    },
  };
}
it("registers synchronously and forwards active close requests without native default destruction", async () => {
  const native = registration();
  const onClose = vi.fn();
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    onClose,
  );
  expect(native.register).toHaveBeenCalledTimes(1);
  const event = native.event();
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith(event);
  native.pending.resolve(vi.fn());
  await subscription.ready;
  subscription.release();
});
it("releases a resolved native listener exactly once", async () => {
  const native = registration();
  const stop = vi.fn();
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    vi.fn(),
  );
  native.pending.resolve(stop);
  await subscription.ready;
  subscription.release();
  subscription.release();
  expect(stop).toHaveBeenCalledTimes(1);
});
it("immediately releases a listener resolving after its owner was disposed", async () => {
  const native = registration();
  const stop = vi.fn();
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    vi.fn(),
  );
  subscription.release();
  subscription.release();
  native.pending.resolve(stop);
  await subscription.ready;
  expect(stop).toHaveBeenCalledTimes(1);
});
it("suppresses stale callbacks while blocking Tauri's default destroy path", async () => {
  const native = registration();
  const onClose = vi.fn();
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    onClose,
  );
  subscription.release();
  const stale = native.event();
  expect(stale.preventDefault).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  native.pending.resolve(vi.fn());
  await subscription.ready;
  native.event();
  expect(onClose).not.toHaveBeenCalled();
});
it("does not release a replacement registration when the old registration settles late", async () => {
  const old = registration();
  const next = registration();
  const oldStop = vi.fn();
  const nextStop = vi.fn();
  const onNext = vi.fn();
  const first = ownHarnessWindowCloseSubscription(old.register, vi.fn());
  first.release();
  const second = ownHarnessWindowCloseSubscription(next.register, onNext);
  next.pending.resolve(nextStop);
  await second.ready;
  old.pending.resolve(oldStop);
  await first.ready;
  expect(oldStop).toHaveBeenCalledTimes(1);
  expect(nextStop).not.toHaveBeenCalled();
  next.event();
  expect(onNext).toHaveBeenCalledTimes(1);
  second.release();
  expect(nextStop).toHaveBeenCalledTimes(1);
});
it("cleanup makes callbacks inactive before invoking native unlisten", async () => {
  const native = registration();
  const onClose = vi.fn();
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    onClose,
  );
  const stop = vi.fn(() => {
    native.event();
  });
  native.pending.resolve(stop);
  await subscription.ready;
  subscription.release();
  expect(onClose).not.toHaveBeenCalled();
});
it("exposes asynchronous registration failure and suppresses the failed owner's callbacks", async () => {
  const native = registration();
  const onClose = vi.fn();
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    onClose,
  );
  const failure = expect(subscription.ready).rejects.toThrow("unavailable");
  native.pending.reject(new Error("unavailable"));
  await failure;
  native.event();
  expect(onClose).not.toHaveBeenCalled();
  subscription.release();
});
it("exposes a synchronous registration failure as a rejected ready promise", async () => {
  const subscription = ownHarnessWindowCloseSubscription(() => {
    throw new Error("unavailable");
  }, vi.fn());
  await expect(subscription.ready).rejects.toThrow("unavailable");
  expect(() => subscription.release()).not.toThrow();
});
it("prevents default destruction even when the active callback throws", async () => {
  const native = registration();
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    () => {
      throw new Error("handler failure");
    },
  );
  native.pending.resolve(vi.fn());
  await subscription.ready;
  const preventDefault = vi.fn();
  const callback = native.register.mock.calls[0]?.[0];
  if (!callback) throw new Error("Expected callback.");
  expect(() => callback({ preventDefault })).toThrow("handler failure");
  expect(preventDefault).toHaveBeenCalledTimes(1);
  subscription.release();
});
it("does not retry an unlisten that throws after its handle was consumed", async () => {
  const native = registration();
  const stop = vi.fn(() => {
    throw new Error("cleanup failure");
  });
  const subscription = ownHarnessWindowCloseSubscription(
    native.register,
    vi.fn(),
  );
  native.pending.resolve(stop);
  await subscription.ready;
  expect(() => subscription.release()).toThrow("cleanup failure");
  expect(() => subscription.release()).not.toThrow();
  expect(stop).toHaveBeenCalledTimes(1);
});
