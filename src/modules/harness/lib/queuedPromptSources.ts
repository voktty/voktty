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
    assertCurrent(owner: object, id: string, cwd: string) {
      const entry = [...entries].find(
        (entry) => entry.owner === owner && entry.id === id,
      );
      if (!entry) {
        if (cwd.startsWith("remote://voktty-ssh-"))
          throw new PromptSourceRetiredError();
        return;
      }
      if (entry.claimed || entry.cwd !== cwd)
        throw new PromptSourceRetiredError();
      entry.source?.assertCurrent();
    },
    take(owner: object, id: string, cwd: string): Source {
      const entry = [...entries].find(
        (entry) => entry.owner === owner && entry.id === id,
      );
      if (!entry)
        return cwd.startsWith("remote://voktty-ssh-")
          ? retiredSource()
          : undefined;
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
