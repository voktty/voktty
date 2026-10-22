// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionReminders } from "@/modules/harness/hooks/useSessionReminders";
import {
  createPersistenceAdmission,
  type PersistenceOwner,
} from "@/modules/harness/lib/persistenceAdmission";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  message: vi.fn(),
  listeners: new Map<string, () => void>(),
  registered: [] as { event: string; handler: () => void }[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: () => void) => {
    native.registered.push({ event, handler });
    native.listeners.set(event, handler);
    return () => {
      if (native.listeners.get(event) === handler)
        native.listeners.delete(event);
    };
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: native.message }));
vi.mock("@/modules/harness/lib/notifications", () => ({
  loadNotificationsEnabled: () => true,
  NOTIFICATIONS_CHANGE_EVENT: "notifications",
}));
vi.mock("@/modules/harness/lib/sounds", () => ({
  loadSoundsEnabled: () => true,
  SOUNDS_CHANGE_EVENT: "sounds",
}));

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing reminder fixture");
  return value;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useSessionReminders>;
const open = vi.fn(async () => {});

async function mount(
  owner: PersistenceOwner | undefined,
  save: (ids: readonly string[]) => Promise<void>,
) {
  function View() {
    const reminders = useSessionReminders(
      open,
      save,
      [],
      owner ? () => owner : undefined,
    );
    useEffect(() => {
      current = reminders;
    });
    return null;
  }
  await act(async () =>
    root.render(
      <StrictMode>
        <View />
      </StrictMode>,
    ),
  );
}
function authority() {
  const admission = createPersistenceAdmission();
  const owner = admission.createOwner();
  const closer = admission.createOwner();
  return { owner, seal: () => required(required(closer.capture()).seal()) };
}
const writes = () =>
  native.invoke.mock.calls.filter(([command]) => command === "reminder_set");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "reminder_list") return [];
    if (command === "reminder_take_pending_open") return null;
  });
  native.message.mockReset().mockResolvedValue(undefined);
  native.listeners.clear();
  native.registered.length = 0;
  open.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("reminder action admission", () => {
  it("does not schedule after close cancellation during transcript saving", async () => {
    const f = authority();
    const gate = deferred();
    await mount(f.owner, () => gate.promise);
    const pending = current.schedule(["original"], 100);
    f.seal().cancel();
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(writes()).toEqual([]);
  });

  it("does not schedule after its hook unmounts during saving", async () => {
    const f = authority();
    const gate = deferred();
    await mount(f.owner, () => gate.promise);
    const pending = current.schedule(["original"], 100);
    await act(async () => root.unmount());
    gate.resolve();
    await pending;
    expect(writes()).toEqual([]);
  });

  it("copies the selected ids before waiting for save", async () => {
    const f = authority();
    const gate = deferred();
    await mount(f.owner, () => gate.promise);
    const ids = ["original"];
    const pending = current.schedule(ids, 100);
    ids[0] = "replacement";
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(writes()).toEqual([
      ["reminder_set", { sessionIds: ["original"], dueAt: 100 }],
    ]);
  });

  it("retains an admitted save in the final close drain", async () => {
    const f = authority();
    const gate = deferred();
    await mount(f.owner, () => gate.promise);
    const pending = current.schedule(["original"], 100);
    const final = f.seal();
    try {
      expect(final.pending).not.toBeNull();
    } finally {
      await act(async () => {
        gate.resolve();
        await pending;
      });
    }
    await final.pending;
  });

  it("denies at capacity before saving or setting reminders", async () => {
    const f = authority();
    const save = vi.fn(async () => {});
    await mount(f.owner, save);
    const gate = deferred();
    const permit = required(f.owner.capture());
    const pending = Array.from({ length: 256 }, () =>
      permit.run(() => gate.promise),
    );
    try {
      await act(async () => current.schedule(["original"], 100));
      expect(save).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
    } finally {
      gate.resolve();
      await Promise.all(pending);
    }
  });

  it("does not report an obsolete save failure after unmount", async () => {
    const f = authority();
    const gate = deferred();
    await mount(f.owner, () => gate.promise);
    const pending = current.schedule(["original"], 100);
    await act(async () => root.unmount());
    gate.reject(new Error("obsolete"));
    await pending;
    expect(native.message).not.toHaveBeenCalled();
  });

  it("schedules a healthy current action after saving", async () => {
    const f = authority();
    const save = vi.fn(async () => {});
    await mount(f.owner, save);
    await act(async () => current.schedule(["original"], 100));
    expect(save).toHaveBeenCalledExactlyOnceWith(["original"]);
    expect(writes()).toEqual([
      ["reminder_set", { sessionIds: ["original"], dueAt: 100 }],
    ]);
  });

  it.each(["cancel", "open"] as const)(
    "retains a native %s receipt until settlement",
    async (action) => {
      const f = authority();
      await mount(f.owner, async () => {});
      const gate = deferred();
      const command = action === "cancel" ? "reminder_clear" : "reminder_open";
      native.invoke.mockImplementation(async (name: string) => {
        if (name === command) await gate.promise;
        if (name === "reminder_list") return [];
      });
      const pending =
        action === "cancel"
          ? current.cancel(["original"], 100)
          : current.open({ sessionId: "original", dueAt: 100 });
      const final = f.seal();
      try {
        expect(final.pending).not.toBeNull();
      } finally {
        await act(async () => {
          gate.resolve();
          await pending;
        });
      }
      await final.pending;
      expect(native.message).not.toHaveBeenCalled();
    },
  );

  it("does not open a consumed notification after its original permit expires", async () => {
    const f = authority();
    await mount(f.owner, async () => {});
    const gate = deferred();
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "reminder_take_pending_open") {
        await gate.promise;
        return { sessionId: "original", dueAt: 100 };
      }
      if (command === "reminder_list") return [];
    });
    await act(async () =>
      required(native.listeners.get("voktty:reminder-open"))(),
    );
    const final = f.seal();
    expect(final.pending).not.toBeNull();
    final.cancel();
    await act(async () => {
      gate.resolve();
      await final.pending;
    });
    expect(open).not.toHaveBeenCalled();
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_clear",
      ),
    ).toEqual([]);
  });

  it("passes the captured permit to session opening and does not clear after sealing", async () => {
    const f = authority();
    await mount(f.owner, async () => {});
    const gate = deferred();
    open.mockImplementationOnce(() => gate.promise);
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "reminder_take_pending_open")
        return { sessionId: "original", dueAt: 100 };
      if (command === "reminder_list") return [];
    });
    await act(async () =>
      required(native.listeners.get("voktty:reminder-open"))(),
    );
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]).toEqual([
      "original",
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    ]);
    const final = f.seal();
    await act(async () => {
      gate.resolve();
      await final.pending;
    });
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_clear",
      ),
    ).toEqual([]);
  });

  it("does not let a discarded StrictMode subscription use its replacement lifetime", async () => {
    const f = authority();
    await mount(f.owner, async () => {});
    const retired = required(
      native.registered.find(
        (entry) => entry.event === "voktty:reminders-changed",
      ),
    );
    expect(native.listeners.get(retired.event)).not.toBe(retired.handler);
    native.invoke.mockClear();
    await act(async () => retired.handler());
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("preserves scheduling for callers that omit admission", async () => {
    const save = vi.fn(async () => {});
    await mount(undefined, save);
    await act(async () => current.schedule(["legacy"], 100));
    expect(save).toHaveBeenCalledExactlyOnceWith(["legacy"]);
    expect(writes()).toEqual([
      ["reminder_set", { sessionIds: ["legacy"], dueAt: 100 }],
    ]);
  });

  it("does not restart bootstrap notification consumption after close cancellation", async () => {
    const f = authority();
    const gate = deferred();
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "reminder_list") {
        await gate.promise;
        return [];
      }
      if (command === "reminder_take_pending_open") return null;
    });
    await mount(f.owner, async () => {});
    f.seal().cancel();
    await act(async () => gate.resolve());
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_take_pending_open",
      ),
    ).toEqual([]);
  });
});
