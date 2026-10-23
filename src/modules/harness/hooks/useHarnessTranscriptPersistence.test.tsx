// @vitest-environment happy-dom
import { act, useCallback, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessTranscriptPersistence } from "@/modules/harness/hooks/useHarnessTranscriptPersistence";
import { newTab, type WorkspaceTab } from "@/modules/harness/lib/layout";
import {
  createPersistenceAdmission,
  type PersistenceOwner,
} from "@/modules/harness/lib/persistenceAdmission";
import { newSession, type Session } from "@/modules/harness/lib/session";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

type Persistence = ReturnType<typeof useHarnessTranscriptPersistence>;
let root: Root;
let container: HTMLDivElement;
let api: Persistence | null;
let owner: PersistenceOwner;
let authority: ReturnType<typeof createPersistenceAdmission>;
const saved = vi.fn();

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing transcript fixture");
  return value;
}

function record() {
  const session = newSession("claude", "/work/project");
  session.blocks = [{ id: "user", role: "user", text: "hello" }];
  return session;
}
function changed(session: Session, text: string): Session {
  return {
    ...session,
    blocks: [...session.blocks, { id: text, role: "assistant", text }],
  };
}

function Publisher({
  sessions,
  tabs,
  imported,
  revision = 0,
}: {
  sessions: Session[];
  tabs: WorkspaceTab[];
  imported?: Session[];
  revision?: number;
}) {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const getOwner = useCallback(() => owner, []);
  const persistence = useHarnessTranscriptPersistence({
    sessions,
    tabsRef,
    getOwner,
    revision,
    imported,
    onSaved: saved,
  });
  useEffect(() => {
    api = persistence;
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string, args) => {
      if (command === "session_upsert_batch")
        return args.sessions.map((session: Session) => ({
          ...session,
          createdAt: 1,
          updatedAt: 1,
        }));
      return { ...args.session, createdAt: 1, updatedAt: 1 };
    });
  saved.mockReset();
  api = null;
  authority = createPersistenceAdmission();
  owner = authority.createOwner();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  owner.retire();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(
  sessions: Session[],
  options: { visible?: boolean; imported?: Session[]; revision?: number } = {},
) {
  await act(async () =>
    root.render(
      <Publisher
        sessions={sessions}
        tabs={
          options.visible ? sessions.map((session) => newTab(session.id)) : []
        }
        imported={options.imported}
        revision={options.revision}
      />,
    ),
  );
}
function calls(command: string) {
  return native.invoke.mock.calls.filter(([name]) => name === command);
}

describe("runtime-owned transcript persistence", () => {
  it("does not rewrite imported sessions and coalesces parked output to its latest state", async () => {
    const initial = record();
    const imported = [initial];
    await render(imported, { imported });
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(native.invoke).not.toHaveBeenCalled();
    const first = changed(initial, "first");
    await render([first], { imported });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    const latest = changed(first, "latest");
    await render([latest], { imported });
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(calls("session_upsert_batch")).toHaveLength(1);
    expect(
      calls("session_upsert_batch")[0][1].sessions[0].blocks.map(
        (block: { text: string }) => block.text,
      ),
    ).toEqual(["hello", "first", "latest"]);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("saves new user and provider bindings immediately while batching subsequent output", async () => {
    const initial = record();
    await render([initial]);
    expect(calls("session_upsert")).toHaveLength(1);
    const bound = { ...initial, providerSessionId: "provider" };
    await render([bound]);
    expect(calls("session_upsert")).toHaveLength(2);
    await render([changed(bound, "reply")]);
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(calls("session_upsert_batch")).toHaveLength(1);
  });

  it("retains active busy output in memory and saves it when it becomes parked", async () => {
    const initial = { ...record(), busy: true };
    const imported = [initial];
    await render(imported, { imported, visible: true });
    const active = changed(initial, "active");
    await render([active], { imported, visible: true });
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(native.invoke).not.toHaveBeenCalled();
    await render([changed(active, "parked")], { imported });
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(calls("session_upsert_batch")).toHaveLength(1);
  });

  it("a cancelled permit cannot revive an old timer and a revision saves current state", async () => {
    const initial = record();
    const imported = [initial];
    await render(imported, { imported });
    await render([changed(initial, "old")], { imported });
    const final = required(required(owner.capture()).seal());
    const current = changed(initial, "current");
    await render([current], { imported });
    final.cancel();
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(native.invoke).not.toHaveBeenCalled();
    await render([current], { imported, revision: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(calls("session_upsert_batch")).toHaveLength(1);
    expect(calls("session_upsert_batch")[0][1].sessions[0].blocks[1].text).toBe(
      "current",
    );
  });

  it("an admitted direct save drains after hook release without publishing to a departed view", async () => {
    const initial = record();
    await render([initial], { imported: [initial] });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    native.invoke.mockImplementation(async (_command, args) => {
      await gate;
      return { ...args.session, createdAt: 1, updatedAt: 1 };
    });
    act(() => required(api).persistSession(changed(initial, "save")));
    await act(async () => Promise.resolve());
    const final = required(required(owner.capture()).seal());
    const pending = required(final.pending);
    await act(async () => root.unmount());
    finish();
    await pending;
    expect(saved).not.toHaveBeenCalled();
    final.cancel();
  });

  it("exposes only bookkeeping operations and preserves a captured permit on direct saves", async () => {
    const initial = record();
    const imported = [initial];
    await render(imported, { imported });
    const permit = required(owner.capture());
    const final = required(permit.seal());
    final.cancel();
    act(() => required(api).persistSession(changed(initial, "stale"), permit));
    await act(async () => Promise.resolve());
    expect(native.invoke).not.toHaveBeenCalled();
    const next = changed(initial, "saved elsewhere");
    act(() => required(api).markPersisted(next));
    await render([next], { imported });
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(native.invoke).not.toHaveBeenCalled();
    act(() => required(api).forgetFingerprint(next.id));
    await render([{ ...next }], { imported });
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(calls("session_upsert_batch")).toHaveLength(1);
  });

  it("drops a removed session from an already scheduled batch", async () => {
    const initial = record();
    const imported = [initial];
    await render(imported, { imported });
    await render([changed(initial, "pending")], { imported });
    act(() => required(api).dropPending(initial.id));
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
