import {
  captureRemotePromptSource,
  PromptSourceRetiredError,
} from "@/modules/harness/lib/promptSource";

type Source = ReturnType<typeof captureRemotePromptSource>;
type Entry = {
  owner: object;
  id: string;
  cwd: string;
  source: Source;
  claimed: boolean;
};

function retiredSource(): Source {
  return {
    isCurrent: () => false,
    assertCurrent: () => {
      throw new PromptSourceRetiredError();
    },
    release: () => {},
  };
}

function matchesOriginalDirectory(cwd: string, original: unknown): boolean {
  return (
    original === undefined ||
    (typeof original === "string" &&
      original.length > 0 &&
      original.length <= 32768 &&
      !/[\x00-\x1f\x7f]/.test(original) &&
      original === cwd)
  );
}

export function createQueuedPromptSources() {
  const entries = new Set<Entry>();
  const release = (entry: Entry) => {
    if (entries.delete(entry)) entry.source?.release();
  };
  return {
    get size() {
      return entries.size;
    },
    capture(owner: object, id: string, cwd: string) {
      if (entries.size >= 256)
        throw new Error("Project message queue capacity exceeded.");
      const source = captureRemotePromptSource(cwd);
      try {
        source?.assertCurrent();
      } catch (error) {
        source?.release();
        throw error;
      }
      const entry = { owner, id, cwd, source, claimed: false };
      entries.add(entry);
      return () => release(entry);
    },
    assertCurrent(
      owner: object,
      id: string,
      cwd: string,
      originalCwd?: unknown,
    ) {
      if (!matchesOriginalDirectory(cwd, originalCwd))
        throw new PromptSourceRetiredError();
      const entry = [...entries].find(
        (entry) => entry.owner === owner && entry.id === id,
      );
      if (!entry) {
        if (cwd.startsWith("remote://voktty-ssh-"))
          throw new PromptSourceRetiredError();
        if (entries.size >= 256)
          throw new Error("Project message queue capacity exceeded.");
        return;
      }
      if (entry.claimed || entry.cwd !== cwd)
        throw new PromptSourceRetiredError();
      entry.source?.assertCurrent();
    },
    take(
      owner: object,
      id: string,
      cwd: string,
      originalCwd?: unknown,
    ): Source {
      if (!matchesOriginalDirectory(cwd, originalCwd)) return retiredSource();
      const entry = [...entries].find(
        (entry) => entry.owner === owner && entry.id === id,
      );
      if (!entry) {
        if (cwd.startsWith("remote://voktty-ssh-") || entries.size >= 256)
          return retiredSource();
        entries.add({ owner, id, cwd, source: undefined, claimed: true });
        return undefined;
      }
      if (entry.claimed || entry.cwd !== cwd) return retiredSource();
      entry.claimed = true;
      const source = entry.source;
      entry.source = undefined;
      return source;
    },
    reconcile(current: ReadonlyMap<object, ReadonlySet<string>>) {
      for (const entry of entries)
        if (!current.get(entry.owner)?.has(entry.id)) release(entry);
    },
    clear() {
      for (const entry of entries) release(entry);
    },
  };
}
