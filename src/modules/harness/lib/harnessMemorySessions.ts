import type {
  MemoryContextPacket,
  MemoryContextResult,
} from "@/modules/workspace-kit/lib/context";
import {
  createHarnessMemoryDelivery,
  type HarnessMemoryTurnSource,
} from "@/modules/harness/lib/harnessMemoryDelivery";
import {
  inactiveMemoryDelivery,
  type MemoryDeliveryState,
} from "@/modules/workspace-kit/lib/memoryConversation";
import type {
  MemoryConversation,
  MemoryConversationBinding,
} from "@/modules/workspace-kit/lib/memoryConversation";
import {
  createNativeMemoryContext,
  type NativeMemoryContext,
} from "@/modules/workspace-kit/lib/nativeMemoryContext";

type Binding = MemoryConversationBinding;
export type HarnessMemorySession = MemoryConversation;
type Entry = {
  native: NativeMemoryContext;
  isCurrent: () => boolean;
  retired: boolean;
  pending: number;
  acknowledged: boolean;
  closing: Promise<void> | null;
  listeners: Set<() => void>;
};
const entries = new Set<Entry>();
function notify(entry: Entry) {
  for (const listener of [...entry.listeners]) {
    if (!entry.listeners.has(listener)) continue;
    try {
      listener();
    } catch {
      /* Observation cannot undo ownership. */
    }
  }
}
function fail(code: "cancelled" | "busy"): never {
  throw Object.assign(new Error(`Harness memory ${code}`), { code });
}
function collect(entry: Entry) {
  if (entry.retired && entry.acknowledged && entry.pending === 0)
    entries.delete(entry);
}
function close(entry: Entry): Promise<void> {
  const first = !entry.retired;
  entry.retired = true;
  entry.closing ??= Promise.resolve()
    .then(() => entry.native.close())
    .then(() => {
      entry.acknowledged = true;
      collect(entry);
    })
    .catch((error: unknown) => {
      entry.closing = null;
      throw error;
    });
  if (first) {
    notify(entry);
    entry.listeners.clear();
  }
  return entry.closing;
}
function retire(entry: Entry) {
  void close(entry).catch(() => undefined);
}

export function createHarnessMemorySessions() {
  let disposed = false;
  const sessions = new Map<
    object,
    {
      entry: Entry;
      receipt: HarnessMemorySession;
      source: (
        assertCurrent: () => void,
      ) => HarnessMemoryTurnSource | undefined;
    }
  >();
  return {
    capture(
      owner: object,
      projectCwd: string,
      cwd: string,
      isOwnerCurrent: () => boolean,
      supportsDelivery = false,
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
      let enabling = false;
      let deliveryState: MemoryDeliveryState = Object.freeze({
        ...inactiveMemoryDelivery,
        supported: supportsDelivery,
      });
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
        listeners: new Set(),
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
        subscribe(listener: () => void) {
          if (!current()) return () => undefined;
          if (!entry.listeners.has(listener) && entry.listeners.size >= 256)
            fail("busy");
          entry.listeners.add(listener);
          return () => {
            entry.listeners.delete(listener);
          };
        },
        status: () =>
          !current()
            ? "retired"
            : bound
              ? "ready"
              : binding
                ? "binding"
                : "inactive",
        delivery: Object.freeze({
          getSnapshot: () =>
            current() ? deliveryState : inactiveMemoryDelivery,
          async enable(
            packet: MemoryContextPacket,
            isCallerCurrent: () => boolean,
          ) {
            check();
            if (!supportsDelivery || !bound || binding) fail("cancelled");
            if (enabling) fail("busy");
            enabling = true;
            const expected = { ...packet };
            entry.pending += 1;
            const assertCurrent = () => {
              check();
              if (!isCallerCurrent()) fail("cancelled");
              check();
            };
            try {
              assertCurrent();
              if (reading) await reading;
              assertCurrent();
              const result = await receipt.read();
              assertCurrent();
              if (!result) fail("cancelled");
              const fresh = result.packet;
              if (
                result.decision.contextAllowed &&
                fresh &&
                fresh.projectKey === expected.projectKey &&
                fresh.instructionDigest === expected.instructionDigest &&
                fresh.digest === expected.digest &&
                fresh.text === expected.text
              ) {
                deliveryState = Object.freeze({
                  ...deliveryState,
                  enabled: true,
                });
                notify(entry);
              }
              return result;
            } finally {
              enabling = false;
              entry.pending -= 1;
              collect(entry);
            }
          },
        }),
        async bind(input: Binding, isActionCurrent = () => true) {
          check();
          if (binding) fail("busy");
          if (bound) fail("cancelled");
          binding = true;
          entry.pending += 1;
          let started = false;
          try {
            notify(entry);
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
            deliveryState = Object.freeze({
              ...deliveryState,
              root: review.snapshot.root,
            });
            binding = false;
            notify(entry);
            check();
          } catch (error) {
            if (started) await close(entry);
            throw error;
          } finally {
            admission = null;
            binding = false;
            entry.pending -= 1;
            collect(entry);
            if (!entry.retired && !bound) notify(entry);
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
      const delivery = createHarnessMemoryDelivery(receipt, (accepted) => {
        if (!current()) return;
        deliveryState = Object.freeze({ ...deliveryState, receipt: accepted });
        notify(entry);
      });
      entries.add(entry);
      sessions.set(owner, {
        entry,
        receipt,
        source: (assertCurrent) =>
          deliveryState.enabled && current()
            ? delivery.capture(() => {
                assertCurrent();
                if (!deliveryState.enabled) fail("cancelled");
              })
            : undefined,
      });
      return receipt;
    },
    turnSource(owner: object | undefined, assertCurrent: () => void) {
      return owner ? sessions.get(owner)?.source(assertCurrent) : undefined;
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
  const delivery = session.delivery;
  function check() {
    if (!isActionCurrent() || !session.isCurrent()) fail("cancelled");
  }
  return Object.freeze({
    ...session,
    isCurrent: () => isActionCurrent() && session.isCurrent(),
    status: () => (isActionCurrent() ? session.status() : "retired"),
    ...(delivery
      ? {
          delivery: Object.freeze({
            getSnapshot: () =>
              isActionCurrent()
                ? delivery.getSnapshot()
                : inactiveMemoryDelivery,
            async enable(
              packet: MemoryContextPacket,
              isCallerCurrent: () => boolean,
            ) {
              check();
              const result = await delivery.enable(
                packet,
                () => isActionCurrent() && isCallerCurrent(),
              );
              check();
              return result;
            },
          }),
        }
      : {}),
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
