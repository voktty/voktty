export type PreparedWindowClose = {
  isCurrent: () => boolean;
  cancel: () => void;
};

export type WindowCloseCapture = {
  busy: boolean;
  closeToTray: boolean;
  isCurrent: () => boolean;
  cancel: () => void;
  prepare: () => Promise<PreparedWindowClose>;
  hide: () => Promise<void>;
};

export function createWindowCloseParticipants() {
  const sources = new Set<() => WindowCloseCapture>();
  let revision = 0;
  return {
    register(source: () => WindowCloseCapture) {
      if (sources.size >= 16 || sources.has(source))
        throw new Error(
          "Window close participant capacity or identity conflict.",
        );
      sources.add(source);
      revision++;
      return () => {
        if (sources.delete(source)) revision++;
      };
    },
    capture() {
      const original = revision;
      const captured = [...sources].map((source) => source());
      const prepared = new Map<WindowCloseCapture, PreparedWindowClose>();
      let cancelled = false;
      let preparing: Promise<void> | undefined;
      const isCurrent = () =>
        !cancelled &&
        revision === original &&
        captured.every((entry) => (prepared.get(entry) ?? entry).isCurrent());
      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        for (const entry of captured) entry.cancel();
      };
      return {
        busy: captured.some((entry) => entry.busy),
        closeToTray: captured.some((entry) => entry.closeToTray),
        isCurrent,
        cancel,
        hide: async () => {
          if (!isCurrent()) throw new Error("Window close was retired.");
          await captured.find((entry) => entry.closeToTray)?.hide();
        },
        prepare: () => {
          preparing ??= (async () => {
            try {
              if (!isCurrent()) throw new Error("Window close was retired.");
              for (const entry of captured) {
                const receipt = await entry.prepare();
                prepared.set(entry, receipt);
                if (!isCurrent()) {
                  receipt.cancel();
                  throw new Error("Window close was retired.");
                }
              }
            } catch (error) {
              // A late receipt still belongs to the cancelled capture.
              cancel();
              throw error;
            }
          })();
          return preparing;
        },
      };
    },
  };
}

export const windowCloseParticipants = createWindowCloseParticipants();
