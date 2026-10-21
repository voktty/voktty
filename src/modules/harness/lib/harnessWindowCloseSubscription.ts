type HarnessCloseEvent = { preventDefault: () => void };
type RegisterClose = (
  listener: (event: HarnessCloseEvent) => void,
) => Promise<() => void>;

export function ownHarnessWindowCloseSubscription(
  register: RegisterClose,
  onClose: (event: HarnessCloseEvent) => void,
) {
  let active = true;
  let unlisten: (() => void) | undefined;
  const listener = (event: HarnessCloseEvent) => {
    // Tauri destroys the window after an unprevented callback, including a stale one.
    event.preventDefault();
    if (active) onClose(event);
  };
  let registration: Promise<() => void>;
  try {
    registration = register(listener);
  } catch (error) {
    registration = Promise.reject(error);
  }
  const ready = registration.then(
    (stop) => {
      if (active) unlisten = stop;
      else stop();
    },
    (error: unknown) => {
      active = false;
      throw error;
    },
  );
  return {
    ready,
    release: () => {
      if (!active) return;
      active = false;
      const stop = unlisten;
      unlisten = undefined;
      stop?.();
    },
  };
}
