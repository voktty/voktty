import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function loadStore() {
  vi.resetModules();
  native.invoke.mockResolvedValue(undefined);
  return import("@/modules/harness/lib/sessionStore");
}

afterEach(() => {
  native.invoke.mockReset();
});

describe("in-flight payload capture at queue admission", () => {
  it("rejects failed entry capture without poisoning a pending predecessor or successor", async () => {
    const { replaceInFlightSessions } = await loadStore();
    const gate = deferred();
    native.invoke.mockReturnValueOnce(gate.promise);
    const first = replaceInFlightSessions([
      { sessionId: "first", cwd: "/work/first" },
    ]);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    const failure = new Error("capture failed");
    const bad = {
      sessionId: "bad",
      get cwd(): string {
        throw failure;
      },
    };
    await expect(replaceInFlightSessions([bad])).rejects.toBe(failure);
    const successor = replaceInFlightSessions([
      { sessionId: "next", cwd: "/work/next" },
    ]);
    expect(native.invoke).toHaveBeenCalledOnce();
    gate.resolve();
    await Promise.all([first, successor]);
    expect(native.invoke.mock.calls).toEqual([
      [
        "session_set_in_flight",
        { sessions: [{ sessionId: "first", cwd: "/work/first" }] },
      ],
      [
        "session_set_in_flight",
        { sessions: [{ sessionId: "next", cwd: "/work/next" }] },
      ],
    ]);
  });
  it("copies and normalizes before the first queued invocation", async () => {
    const { replaceInFlightSessions } = await loadStore();
    const refs = [{ sessionId: "original", cwd: "C:\\work\\project" }];
    const writing = replaceInFlightSessions(refs);
    refs[0].sessionId = "later";
    refs[0].cwd = "/work/later";
    refs.push({ sessionId: "extra", cwd: "/work/extra" });
    await writing;
    expect(native.invoke).toHaveBeenCalledWith("session_set_in_flight", {
      sessions: [{ sessionId: "original", cwd: "c:/work/project" }],
    });
  });

  it.each(["resolve", "reject"] as const)(
    "retains an admitted successor payload when predecessor %ss",
    async (outcome) => {
      const { replaceInFlightSessions } = await loadStore();
      const gate = deferred();
      native.invoke.mockReturnValueOnce(gate.promise);
      const first = replaceInFlightSessions([
        { sessionId: "first", cwd: "/work/first" },
      ]);
      const observed = first.catch((error: unknown) => error);
      await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
      const refs = [{ sessionId: "second", cwd: "C:\\work\\second" }];
      const second = replaceInFlightSessions(refs);
      refs[0].cwd = "/work/later";
      refs.length = 0;
      expect(native.invoke).toHaveBeenCalledOnce();
      if (outcome === "resolve") gate.resolve();
      else gate.reject(new Error("write failed"));
      await Promise.all([observed, second]);
      expect(native.invoke.mock.calls).toEqual([
        [
          "session_set_in_flight",
          { sessions: [{ sessionId: "first", cwd: "/work/first" }] },
        ],
        [
          "session_set_in_flight",
          { sessions: [{ sessionId: "second", cwd: "c:/work/second" }] },
        ],
      ]);
    },
  );

  it("keeps empty replacement intentional and ordered after a pending write", async () => {
    const { replaceInFlightSessions } = await loadStore();
    const gate = deferred();
    native.invoke.mockReturnValueOnce(gate.promise);
    const first = replaceInFlightSessions([
      { sessionId: "first", cwd: "/work/first" },
    ]);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    const empty = replaceInFlightSessions([]);
    expect(native.invoke).toHaveBeenCalledOnce();
    gate.resolve();
    await Promise.all([first, empty]);
    expect(native.invoke).toHaveBeenLastCalledWith("session_set_in_flight", {
      sessions: [],
    });
  });

  it("does not block independent workspace writes behind in-flight persistence", async () => {
    const { replaceInFlightSessions, saveWorkspaceSnapshot } =
      await loadStore();
    const gate = deferred();
    native.invoke.mockImplementation((command: string) =>
      command === "session_set_in_flight" ? gate.promise : Promise.resolve(),
    );
    const inFlight = replaceInFlightSessions([
      { sessionId: "first", cwd: "/work/first" },
    ]);
    const snapshot = { activeTabId: "tab", projectCwd: "/work/first" };
    await saveWorkspaceSnapshot(snapshot);
    expect(native.invoke).toHaveBeenCalledWith("workspace_set_snapshot", {
      snapshot,
    });
    gate.resolve();
    await inFlight;
  });
});
