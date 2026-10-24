export type HarnessWindowState = { version: 1; payload: string };

export const MAX_HARNESS_WINDOW_STATE = 4 * 1024 * 1024;

export function parseHarnessWindowState(value: unknown): HarnessWindowState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<HarnessWindowState>;
  if (state.version !== 1 || typeof state.payload !== "string" ||
      state.payload.length > MAX_HARNESS_WINDOW_STATE) return undefined;
  return { version: 1, payload: state.payload };
}

export function createWindowSessionState() {
  let source: { read: () => HarnessWindowState } | undefined;
  let saved: HarnessWindowState | undefined;
  let boot: HarnessWindowState | undefined;
  let restore = true;
  let managed = false;
  let revision = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    revision++;
    for (const listener of [...listeners]) listener();
  };
  const capture = () => {
    if (source) saved = source.read();
    return saved;
  };
  return {
    capture,
    changed,
    manage: () => { managed = true; },
    isManaged: () => managed,
    getRevision: () => revision,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    seed(value: HarnessWindowState | undefined, allowRestore: boolean) {
      if (source) throw new Error("Cannot replace a live Harness boot source.");
      boot = value;
      saved = value;
      restore = allowRestore;
    },
    boot: () => ({ state: boot, restore }),
    install(read: () => HarnessWindowState) {
      if (source) throw new Error("Harness window snapshot owner already exists.");
      const original = { read };
      source = original;
      changed();
      return () => {
        if (source !== original) return;
        try {
          capture();
        } finally {
          source = undefined;
          changed();
        }
      };
    },
  };
}

export const windowSessionState = createWindowSessionState();
