import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySessionSync,
  type HostSession,
} from "@/modules/connections/model/protocol";
import { HostStore } from "./store";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "voktty-store-"));
  const path = join(directory, "host.db");
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const open = () => {
    const store = new HostStore(path);
    cleanups.push(() => store.close());
    return store;
  };
  const store = open();
  const project = store.addProject(directory, "Project");
  const session: HostSession = {
    projectId: project.id,
    revision: 1,
    status: "idle",
    updatedAt: 100,
    session: {
      id: "session",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      cwd: directory,
      title: "Session",
      blocks: [{ id: "block", role: "assistant", text: "Original" }],
    },
  };
  store.save(session, { type: "created" });
  return { store, open, session };
}

it("persists environment, projects, sessions and receipts across connections", () => {
  const { store, open, session } = setup();
  const receipt = { commandId: "send", sessionId: "session", revision: 1 };
  store.recordReceipt("payload", receipt);
  const reopened = open();
  expect(reopened.environmentId).toBe(store.environmentId);
  expect(reopened.projects()).toEqual(store.projects());
  expect(reopened.session("session")).toEqual(store.session("session"));
  expect(reopened.receipt("send", "payload")).toEqual(receipt);
  expect(() => reopened.receipt("send", "different")).toThrow(
    "different payload",
  );
  expect(reopened.session("session").createdAt).toBe(session.updatedAt);
});

it("rolls back snapshot, events, cache and receipt as one transaction", () => {
  const { store } = setup();
  const previous = store.session("session");
  expect(() =>
    store.transaction(() => {
      store.save({ ...previous, revision: 2 }, { type: "changed" });
      store.recordReceipt("payload", {
        commandId: "failed",
        sessionId: "session",
        revision: 2,
      });
      throw new Error("storage failed");
    }),
  ).toThrow("storage failed");
  expect(store.session("session")).toEqual(previous);
  expect(store.receipt("failed", "payload")).toBeUndefined();
  expect(store.events("session", 1)).toEqual({ events: [], revision: 1 });
});

it("keeps a standalone save atomic when its event cannot be persisted", () => {
  const { store } = setup();
  const previous = store.session("session");
  expect(() =>
    store.save(
      { ...previous, session: { ...previous.session, title: "Unsaved" } },
      {},
    ),
  ).toThrow();
  expect(store.session("session")).toEqual(previous);
  expect(store.summaries(previous.projectId)[0].title).toBe("Session");
});

it("reconstructs deltas with changed, inserted and removed blocks", () => {
  const { store } = setup();
  const base = applySessionSync(undefined, store.sync("session"));
  const next = store.save(
    {
      ...base,
      revision: 2,
      updatedAt: 200,
      session: {
        ...base.session,
        blocks: [
          { ...base.session.blocks[0], text: "Changed" },
          { id: "new", role: "assistant", text: "New" },
        ],
      },
    },
    {},
  );
  const delta = store.sync("session", 1);
  expect(delta.kind).toBe("delta");
  expect(applySessionSync(base, delta)).toEqual(
    applySessionSync(undefined, store.sync("session")),
  );
  store.save(
    {
      ...next,
      revision: 3,
      session: { ...next.session, blocks: [next.session.blocks[1]] },
    },
    {},
  );
  const removed = store.sync("session", 2);
  if (removed.kind !== "delta") throw new Error("Expected delta");
  expect(removed.blockIds).toEqual(["new"]);
  expect(removed.blocks).toEqual([]);
  expect(store.sync("session", 3)).toEqual({ kind: "unchanged", revision: 3 });
  expect(store.sync("session", 4).kind).toBe("snapshot");
});

it("preserves creation time and atomically validates session metadata", () => {
  const { store, session } = setup();
  store.save({ ...store.session("session"), revision: 2, updatedAt: 200 }, {});
  expect(
    store.updateSession("session", {
      title: "  Renamed  ",
      pinned: true,
      archived: true,
    }),
  ).toMatchObject({
    title: "Renamed",
    pinned: true,
    archived: true,
    createdAt: 100,
  });
  expect(() =>
    store.updateSession("session", { title: " ", pinned: false }),
  ).toThrow("title");
  expect(store.summaries(session.projectId)[0].pinned).toBe(true);
});

it("stores credential hashes and revokes only the selected device", () => {
  const { store, open } = setup();
  const first = store.issueDevice("First");
  const second = store.issueDevice("Second");
  const rows = JSON.stringify(store.db.prepare("SELECT * FROM devices").all());
  expect(rows).not.toContain(first.token);
  expect(rows).not.toContain(second.token);
  expect(open().authenticated(first.token)).toBe(true);
  expect(store.authenticated("wrong")).toBe(false);
  expect(store.revokeToken(first.token)).toBe(true);
  expect(store.authenticated(first.token)).toBe(false);
  expect(store.authenticated(second.token)).toBe(true);
  expect(store.revokeDevice(second.id)).toBe(true);
  expect(store.revokeDevice(second.id)).toBe(false);
});

it("prevents deleting a running session and cleans up idle events", () => {
  const { store } = setup();
  const current = store.session("session");
  store.save({ ...current, revision: 2, status: "running" }, {});
  expect(() => store.deleteSession("session")).toThrow("Stop");
  store.save({ ...current, revision: 3 }, {});
  store.deleteSession("session");
  expect(() => store.session("session")).toThrow("not found");
  expect(store.db.prepare("SELECT * FROM events").all()).toEqual([]);
});
