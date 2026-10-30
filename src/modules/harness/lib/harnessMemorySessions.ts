import type {
  createNativeMemoryPresentation,
  NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type { NativeMemoryTrustReview } from "@/modules/workspace-kit/lib/nativeMemoryTrust";
import {
  createNativeMemoryContext,
  type NativeMemoryContext,
} from "@/modules/workspace-kit/lib/nativeMemoryContext";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";

type Binding = Readonly<{
  presentation: Pick<
    ReturnType<typeof createNativeMemoryPresentation>,
    "bindContext" | "isLocalSelection"
  >;
  selection: NativeMemorySelection;
  review: NativeMemoryTrustReview;
  mode: "inherit" | "enabled" | "disabled";
}>;
export type HarnessMemorySession = Readonly<{
  projectCwd: string;
  cwd: string;
  isCurrent: () => boolean;
  status: () => "inactive" | "binding" | "ready" | "retired";
  bind: (input: Binding, isActionCurrent?: () => boolean) => Promise<void>;
  read: () => Promise<MemoryContextResult | null>;
  close: () => Promise<void>;
}>;
type Entry = {
  native: NativeMemoryContext;
  isCurrent: () => boolean;
  retired: boolean;
  pending: number;
  acknowledged: boolean;
  closing: Promise<void> | null;
};
const entries = new Set<Entry>();
function fail(code: "cancelled" | "busy"): never {
  throw Object.assign(new Error(`Harness memory ${code}`), { code });
}
function collect(entry: Entry) {
  if (entry.retired && entry.acknowledged && entry.pending === 0)
    entries.delete(entry);
}
function close(entry: Entry): Promise<void> {
  entry.retired = true;
  if (entry.closing) return entry.closing;
  entry.closing = Promise.resolve()
    .then(() => entry.native.close())
    .then(() => {
      entry.acknowledged = true;
      collect(entry);
    })
    .catch((error: unknown) => {
      entry.closing = null;
      throw error;
    });
  return entry.closing;
}
function retire(entry: Entry) {
  void close(entry).catch(() => undefined);
}

export function createHarnessMemorySessions() {
  let disposed = false;
  const sessions = new Map<
    object,
    { entry: Entry; receipt: HarnessMemorySession }
  >();
  return {
    capture(
      owner: object,
      projectCwd: string,
      cwd: string,
      isOwnerCurrent: () => boolean,
    ): HarnessMemorySession {
      if (disposed || !isOwnerCurrent() || disposed) fail("cancelled");
      const existing = sessions.get(owner);
      if (existing && !existing.entry.retired) return existing.receipt;
      for (const entry of entries) if (entry.retired) retire(entry);
      if (entries.size >= 256) fail("busy");
      let bound = false;
      let binding = false;
      let admission: (() => boolean) | null = null;
      let reading: Promise<MemoryContextResult | null> | null = null;
      const current = () =>
        !disposed &&
        !entry.retired &&
        isOwnerCurrent() &&
        !disposed &&
        !entry.retired;
      const entry: Entry = {
        native: createNativeMemoryContext(
          () => current() && (bound || admission?.() === true),
        ),
        isCurrent: current,
        retired: false,
        pending: 0,
        acknowledged: false,
        closing: null,
      };
      const check = () => {
        if (!current()) {
          retire(entry);
          fail("cancelled");
        }
      };
      const receipt: HarnessMemorySession = Object.freeze({
        projectCwd,
        cwd,
        isCurrent: current,
        status: () =>
          !current()
            ? "retired"
            : bound
              ? "ready"
              : binding
                ? "binding"
                : "inactive",
        async bind(input: Binding, isActionCurrent = () => true) {
          check();
          if (binding) fail("busy");
          if (bound) fail("cancelled");
          binding = true;
          entry.pending += 1;
          let started = false;
          try {
            const { presentation, selection, review, mode } = input;
            if (!isActionCurrent()) fail("cancelled");
            check();
            if (!presentation.isLocalSelection(selection, cwd))
              fail("cancelled");
            check();
            admission = isActionCurrent;
            started = true;
            await presentation.bindContext(
              selection,
              review,
              entry.native,
              mode,
            );
            check();
            if (!isActionCurrent()) fail("cancelled");
            check();
            bound = true;
          } catch (error) {
            if (started) await close(entry);
            throw error;
          } finally {
            admission = null;
            binding = false;
            entry.pending -= 1;
            collect(entry);
          }
        },
        read() {
          try {
            check();
            if (binding) fail("busy");
            if (!bound) return Promise.resolve(null);
            if (reading) return reading;
            entry.pending += 1;
            reading = Promise.resolve().then(async () => {
              try {
                check();
                const result = await entry.native.read();
                check();
                return result;
              } catch (error) {
                check();
                throw error;
              } finally {
                entry.pending -= 1;
                reading = null;
                collect(entry);
              }
            });
            return reading;
          } catch (error) {
            return Promise.reject(error);
          }
        },
        close: () => close(entry),
      });
      entries.add(entry);
      sessions.set(owner, { entry, receipt });
      return receipt;
    },
    reconcile(owners: Iterable<object>) {
      const currentOwners = new Set(owners);
      for (const [owner, { entry }] of sessions) {
        if (!currentOwners.has(owner) || !entry.isCurrent()) {
          sessions.delete(owner);
          retire(entry);
        }
      }
    },
    dispose() {
      disposed = true;
      for (const { entry } of sessions.values()) retire(entry);
      sessions.clear();
    },
  };
}

export function qualifyHarnessMemorySession(
  session: HarnessMemorySession,
  isActionCurrent: () => boolean,
): HarnessMemorySession {
  function check() {
    if (!isActionCurrent() || !session.isCurrent()) fail("cancelled");
  }
  return Object.freeze({
    ...session,
    isCurrent: () => isActionCurrent() && session.isCurrent(),
    status: () => (isActionCurrent() ? session.status() : "retired"),
    async bind(input: Binding, isCallerCurrent = () => true) {
      check();
      const admission = () => isActionCurrent() && isCallerCurrent();
      await session.bind(input, admission);
      if (!admission() || !session.isCurrent()) {
        await session.close();
        fail("cancelled");
      }
    },
    async read() {
      check();
      const result = await session.read();
      check();
      return result;
    },
    close() {
      if (!isActionCurrent()) return Promise.reject({ code: "cancelled" });
      return session.close();
    },
  });
}
