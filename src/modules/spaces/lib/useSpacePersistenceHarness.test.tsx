// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSpacePersistence } from "@/modules/spaces/lib/useSpacePersistence";
import { windowSessionState } from "@/modules/lifecycle/windowSessionState";
import { collectHarnessWindowState, parseHarnessWindowSnapshot } from "@/modules/harness/lib/harnessWindowSnapshot";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { persistQuitState } from "@/modules/harness/lib/appLifecycle";
import { newSession } from "@/modules/harness/lib/session";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import type { SessionEnvelope } from "@/modules/spaces/lib/sessionSnapshot";

const disk = vi.hoisted(() => ({ values: new Map<string, unknown>(), order: [] as string[] }));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get(key: string) { return Promise.resolve(disk.values.get(key)); }
    set(key: string, value: unknown) { disk.order.push(key); disk.values.set(key, value); return Promise.resolve(); }
    has(key: string) { return Promise.resolve(disk.values.has(key)); }
    save() { return Promise.resolve(); }
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { sessions?: unknown[] }) => {
    disk.order.push(command);
    return command === "session_upsert_batch" ? args.sessions : null;
  },
}));

it("promotes one combined root snapshot after final transcripts with no parallel Harness layout write", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const session = { ...newSession("cursor", "/project"), id: "headless",
    blocks: [{ id: "block", role: "user" as const, text: "durable transcript" }] };
  const views = createHarnessWindowViews();
  const release = windowSessionState.install(() => collectHarnessWindowState(views.getSnapshot(), [session], new Map()));
  let persistence: ReturnType<typeof useSpacePersistence> | undefined;
  function Root() {
    persistence = useSpacePersistence({ tabs: [], activeId: 0, activeSpaceId: "default", enabled: true, ownerInstanceId: "root" });
    return null;
  }
  try {
    await act(async () => root.render(<Root />));
    const permit = createPersistenceAdmission().createOwner().capture();
    if (!permit || !persistence) throw new Error("Missing persistence fixture");
    await act(async () => {
      await persistQuitState([session], [], "", "/project", new Map(), "quit", [], undefined, { permit, final: true });
      await persistence?.flushAndPromoteSession();
    });
    expect(disk.order).not.toContain("workspace_set_snapshot");
    expect(disk.order.indexOf("session_upsert_batch")).toBeLessThan(disk.order.indexOf("session:lastCleanSession"));
    const clean = disk.values.get("session:lastCleanSession") as SessionEnvelope;
    expect(clean.snapshot.tabs).toEqual([]);
    expect(clean.snapshot.harness).toBeDefined();
    const state = clean.snapshot.harness;
    if (!state) throw new Error("Missing combined Harness state");
    expect(parseHarnessWindowSnapshot(state).workspace.sessions.map((stub) => stub.id)).toEqual([session.id]);
    expect(state.payload).not.toContain("durable transcript");
  } finally {
    await act(async () => root.unmount());
    release();
    vi.unstubAllGlobals();
  }
});
