// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessReminderWindowContext } from "@/modules/harness/hooks/harnessReminderWindowContext";
import { useHarnessReminderWindow } from "@/modules/harness/hooks/useHarnessReminderWindow";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let authority: ReturnType<typeof createPersistenceAdmission>;
let persistence: ReturnType<typeof useWindowPersistenceAdmission>;
let error: string | null;

function View({ ids }: { ids: string[] }) {
  persistence = useWindowPersistenceAdmission(() => undefined, authority);
  error = useHarnessReminderWindow(
    ids,
    persistence.getOwner,
    persistence.revision,
  );
  return null;
}

async function render(ids: string[], managed = false, strict = false) {
  const view = (
    <HarnessReminderWindowContext.Provider value={managed}>
      <View ids={ids} />
    </HarnessReminderWindowContext.Provider>
  );
  await act(async () =>
    root.render(strict ? <StrictMode>{view}</StrictMode> : view),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.invoke.mockReset().mockResolvedValue(undefined);
  authority = createPersistenceAdmission();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("window reminder registration", () => {
  it("publishes a stable set without repeats for order or duplicate changes", async () => {
    await render(["two", "one", "two"]);
    await render(["one", "two"]);
    expect(native.invoke.mock.calls).toEqual([
      ["reminder_register_window", { sessionIds: ["one", "two"] }],
    ]);
    await render([]);
    expect(native.invoke).toHaveBeenLastCalledWith("reminder_register_window", {
      sessionIds: [],
    });
  });

  it("serializes writes and retains only the latest unsent membership", async () => {
    const gate = deferred();
    native.invoke.mockReturnValueOnce(gate.promise);
    await render(["one"]);
    await render(["two"]);
    await render(["three"]);
    expect(native.invoke).toHaveBeenCalledOnce();
    await act(async () => gate.resolve());
    expect(native.invoke.mock.calls).toEqual([
      ["reminder_register_window", { sessionIds: ["one"] }],
      ["reminder_register_window", { sessionIds: ["three"] }],
    ]);
  });

  it("keeps admitted work in the close drain and republishes current state after cancellation", async () => {
    const gate = deferred();
    native.invoke.mockReturnValueOnce(gate.promise);
    await render(["one"]);
    await render(["two"]);
    const closer = authority.createOwner();
    const final = closer.capture()?.seal();
    expect(final?.pending).not.toBeNull();
    await act(async () => final?.cancel());
    expect(native.invoke).toHaveBeenCalledOnce();
    await act(async () => {
      gate.resolve();
      await final?.pending;
    });
    expect(native.invoke.mock.calls).toEqual([
      ["reminder_register_window", { sessionIds: ["one"] }],
      ["reminder_register_window", { sessionIds: ["two"] }],
    ]);
    closer.retire();
  });

  it("does not dispatch queued membership after unmount", async () => {
    const gate = deferred();
    native.invoke.mockReturnValueOnce(gate.promise);
    await render(["one"]);
    await render(["two"]);
    await act(async () => root.unmount());
    await act(async () => gate.resolve());
    expect(native.invoke).toHaveBeenCalledOnce();
  });

  it("retries current membership when admission capacity becomes available", async () => {
    const writer = authority.createOwner();
    const permit = writer.capture();
    if (!permit) throw new Error("Missing writer permit");
    const gate = deferred();
    const pending = Array.from({ length: 256 }, () =>
      permit.run(() => gate.promise),
    );
    try {
      await render(["one"]);
      expect(native.invoke).not.toHaveBeenCalled();
      await act(async () => {
        gate.resolve();
        await Promise.all(pending);
      });
      expect(native.invoke).toHaveBeenCalledExactlyOnceWith(
        "reminder_register_window",
        { sessionIds: ["one"] },
      );
    } finally {
      gate.resolve();
      await Promise.all(pending);
      writer.retire();
    }
  });

  it("keeps StrictMode replacement behind the unsettled original write", async () => {
    const gate = deferred();
    native.invoke.mockReturnValueOnce(gate.promise);
    await render(["one"], false, true);
    expect(native.invoke).toHaveBeenCalledOnce();
    await act(async () => gate.resolve());
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(error).toBeNull();
  });

  it("suppresses view writers under the host context", async () => {
    await render(["one"], true);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(error).toBeNull();
    await render(["one"]);
    expect(native.invoke).toHaveBeenCalledOnce();
  });

  it("reports current errors and continues with a changed membership", async () => {
    native.invoke.mockRejectedValueOnce(new Error("Registration failed"));
    await render(["one"]);
    expect(error).toContain("Registration failed");
    await render(["two"]);
    expect(error).toBeNull();
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });
});
