// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ownHarnessWindowCloseSubscription } from "./harnessWindowCloseSubscription";

type CloseEvent = { preventDefault: () => void };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("disposes the replayed StrictMode native listener without disabling the current owner", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const requests: {
    listener: (event: CloseEvent) => void;
    pending: ReturnType<typeof deferred<() => void>>;
    stop: ReturnType<typeof vi.fn<() => void>>;
  }[] = [];
  const subscriptions: ReturnType<typeof ownHarnessWindowCloseSubscription>[] =
    [];
  const register = (listener: (event: CloseEvent) => void) => {
    const pending = deferred<() => void>();
    requests.push({ listener, pending, stop: vi.fn<() => void>() });
    return pending.promise;
  };
  const onClose = vi.fn();
  function View() {
    useEffect(() => {
      const subscription = ownHarnessWindowCloseSubscription(register, onClose);
      subscriptions.push(subscription);
      return subscription.release;
    }, []);
    return null;
  }
  let mounted = false;
  try {
    act(() => {
      root.render(
        <StrictMode>
          <View />
        </StrictMode>,
      );
    });
    mounted = true;
    expect(requests).toHaveLength(2);
    const old = requests[0];
    const current = requests[1];
    if (!old || !current) throw new Error("Expected replayed subscriptions.");
    const staleEvent = { preventDefault: vi.fn() };
    old.listener(staleEvent);
    expect(staleEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    const currentEvent = { preventDefault: vi.fn() };
    current.listener(currentEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(currentEvent);
    current.pending.resolve(current.stop);
    old.pending.resolve(old.stop);
    await Promise.all(subscriptions.map((item) => item.ready));
    expect(old.stop).toHaveBeenCalledTimes(1);
    expect(current.stop).not.toHaveBeenCalled();
    act(() => root.unmount());
    mounted = false;
    expect(current.stop).toHaveBeenCalledTimes(1);
    old.listener({ preventDefault: vi.fn() });
    current.listener({ preventDefault: vi.fn() });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
