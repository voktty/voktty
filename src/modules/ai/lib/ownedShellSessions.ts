type Options<Result> = {
  open: () => Promise<number>;
  close: (id: number) => Promise<void>;
  execute: (id: number) => Promise<Result>;
  assertCurrent: () => void;
};
type Owner = {
  retired: boolean;
  entries: Map<string, Entry>;
  retirement?: Promise<void>;
};
type Entry = {
  owner: Owner;
  key: string;
  opening: Promise<number>;
  tail: Promise<void>;
  close: (id: number) => Promise<void>;
  closing?: Promise<void>;
  failed: boolean;
  openingRetired: boolean;
};

export function createOwnedShellSessions(limit = 256) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256)
    throw new Error("Invalid agent shell capacity.");
  const owners = new WeakMap<object, Owner>();
  const resources = new Set<Entry>();
  const ownerFor = (owner: object): Owner => {
    let state = owners.get(owner);
    if (!state) {
      state = { retired: false, entries: new Map() };
      owners.set(owner, state);
    }
    return state;
  };
  const assertOwner = (owner: Owner) => {
    if (owner.retired)
      throw new Error("The original agent shell owner has retired.");
  };
  const collect = (entry: Entry) => {
    if (entry.owner.entries.get(entry.key) === entry)
      entry.owner.entries.delete(entry.key);
    resources.delete(entry);
  };
  const close = (entry: Entry): Promise<void> => {
    if (entry.closing) return entry.closing;
    const tail = entry.tail;
    const opening = entry.opening;
    const closer = entry.close;
    entry.failed = false;
    const attempt = Promise.resolve()
      .then(async () => {
        await tail;
        let id: number;
        try {
          id = await opening;
        } catch {
          collect(entry);
          return;
        }
        await closer(id);
        collect(entry);
      })
      .catch((error) => {
        entry.failed = true;
        throw error;
      })
      .finally(() => {
        if (entry.closing === attempt) entry.closing = undefined;
      });
    entry.closing = attempt;
    return attempt;
  };
  const retryFailed = (): Promise<void> | undefined => {
    const captured = [...resources].filter(
      (entry) => entry.owner.retired && entry.failed && !entry.closing,
    );
    if (!captured.length) return;
    return Promise.allSettled(captured.map(close)).then(() => {});
  };

  const cache = {
    async run<Result>(
      owner: object,
      key: string,
      request: Options<Result>,
    ): Promise<Result> {
      const options = { ...request };
      const state = ownerFor(owner);
      assertOwner(state);
      options.assertCurrent();
      const full = resources.size >= limit;
      const retry = retryFailed();
      if (full && retry) await retry;
      assertOwner(state);
      options.assertCurrent();
      let entry = state.entries.get(key);
      if (!entry) {
        if (resources.size >= limit)
          throw new Error("Too many cached agent shells.");
        const opening = Promise.resolve().then(() => {
          assertOwner(state);
          try {
            options.assertCurrent();
          } catch (error) {
            original.openingRetired = true;
            throw error;
          }
          return options.open();
        });
        const original: Entry = {
          owner: state,
          key,
          opening,
          tail: Promise.resolve(),
          close: options.close,
          failed: false,
          openingRetired: false,
        };
        entry = original;
        state.entries.set(key, original);
        resources.add(original);
        void opening.catch(() => collect(original));
      }
      const original = entry;
      const result = original.tail.then(async () => {
        assertOwner(state);
        options.assertCurrent();
        let id: number;
        try {
          id = await original.opening;
        } catch (error) {
          if (!original.openingRetired) throw error;
          assertOwner(state);
          options.assertCurrent();
          return cache.run(owner, key, options);
        }
        assertOwner(state);
        options.assertCurrent();
        const value = await options.execute(id);
        assertOwner(state);
        options.assertCurrent();
        return value;
      });
      original.tail = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    retire(owner: object): Promise<void> {
      const state = ownerFor(owner);
      state.retired = true;
      if (state.retirement) return state.retirement;
      const captured = [...state.entries.values()];
      const attempt = Promise.allSettled(captured.map(close))
        .then((results) => {
          const failure = results.find(
            (result) => result.status === "rejected",
          );
          if (failure?.status === "rejected") throw failure.reason;
        })
        .finally(() => {
          if (state.retirement === attempt) state.retirement = undefined;
        });
      state.retirement = attempt;
      return attempt;
    },
  };
  return cache;
}

export const agentShellSessions = createOwnedShellSessions();
