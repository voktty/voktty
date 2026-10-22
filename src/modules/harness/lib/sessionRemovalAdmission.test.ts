import { describe, expect, it, vi } from "vitest";
import { newTab } from "@/modules/harness/lib/layout";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import {
  runSessionRemoval,
  runSessionRemovalBatch,
} from "@/modules/harness/lib/sessionRemoval";

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Missing admission fixture");
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

function fixture() {
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const closer = authority.createOwner();
  const permit = required(owner.capture());
  const closing = { ...newSession("cursor", "/work/project"), busy: true };
  const other = newSession("cursor", "/work/project");
  const tabs = [newTab(closing.id), newTab(other.id)];
  const workspace = {
    tabs,
    sessions: [closing, other],
    activeTabId: tabs[0].id,
    dirtyFiles: new Set<string>(),
  };
  const options = {
    sessionId: closing.id,
    scope: "project" as const,
    persistencePermit: permit,
    readWorkspace: vi.fn(() => workspace),
    createReplacement: vi.fn(() => newSession("cursor", "/work/project")),
    confirmClose: vi.fn(async () => true),
    stop: vi.fn(async () => {}),
    updateSession: vi.fn(),
    persist: vi.fn(async () => {}),
    commit: vi.fn(),
  };
  return {
    owner,
    permit,
    options,
    seal: () => required(required(closer.capture()).seal()),
    run: () => runSessionRemoval(options),
  };
}

describe("session removal persistence authority", () => {
  it("does not read or prompt after sealing", async () => {
    const f = fixture();
    f.seal();
    expect(await f.run()).toBe(false);
    expect(f.options.readWorkspace).not.toHaveBeenCalled();
    expect(f.options.confirmClose).not.toHaveBeenCalled();
    expect(f.options.stop).not.toHaveBeenCalled();
    expect(f.options.persist).not.toHaveBeenCalled();
  });

  it("does not stop after owner retirement during confirmation", async () => {
    const f = fixture();
    f.options.confirmClose.mockImplementation(async () => {
      f.owner.retire();
      return true;
    });
    expect(await f.run()).toBe(false);
    expect(f.options.stop).not.toHaveBeenCalled();
    expect(f.options.updateSession).not.toHaveBeenCalled();
    expect(f.options.persist).not.toHaveBeenCalled();
    expect(f.options.commit).not.toHaveBeenCalled();
  });

  it("does not revive an old confirmed action after final-close cancellation", async () => {
    const f = fixture();
    f.options.confirmClose.mockImplementation(async () => {
      f.seal().cancel();
      return true;
    });
    expect(await f.run()).toBe(false);
    expect(f.owner.capture()).not.toBeNull();
    expect(f.options.stop).not.toHaveBeenCalled();
    expect(f.options.commit).not.toHaveBeenCalled();
  });

  it("does not adopt a replacement permit through mutable caller options", async () => {
    const f = fixture();
    f.options.confirmClose.mockImplementation(async () => {
      f.seal().cancel();
      f.options.persistencePermit = required(f.owner.capture());
      return true;
    });
    expect(await f.run()).toBe(false);
    expect(f.options.stop).not.toHaveBeenCalled();
    expect(f.options.commit).not.toHaveBeenCalled();
  });

  it("does not update or persist after sealing during stop", async () => {
    const f = fixture();
    f.options.stop.mockImplementation(async () => {
      f.seal();
    });
    expect(await f.run()).toBe(false);
    expect(f.options.updateSession).not.toHaveBeenCalled();
    expect(f.options.persist).not.toHaveBeenCalled();
    expect(f.options.commit).not.toHaveBeenCalled();
  });

  it("revalidates after a synchronous update callback", async () => {
    const f = fixture();
    f.options.updateSession.mockImplementation(() => {
      f.seal();
    });
    expect(await f.run()).toBe(false);
    expect(f.options.persist).not.toHaveBeenCalled();
    expect(f.options.commit).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "retains admitted persistence until it %ss without committing after seal",
    async (outcome) => {
      const f = fixture();
      const gate = deferred();
      const failure = new Error("storage failed");
      f.options.persist.mockReturnValue(gate.promise);
      const pending = f.run().catch((error: unknown) => error);
      await vi.waitFor(() => expect(f.options.persist).toHaveBeenCalledOnce());
      const final = f.seal();
      try {
        expect(final.pending).not.toBeNull();
        const drained = vi.fn();
        void final.pending?.then(drained);
        await Promise.resolve();
        expect(drained).not.toHaveBeenCalled();
      } finally {
        if (outcome === "resolve") gate.resolve();
        else gate.reject(failure);
      }
      expect(await pending).toBe(outcome === "resolve" ? false : failure);
      await final.pending;
      expect(f.options.commit).not.toHaveBeenCalled();
    },
  );

  it("honors receipt capacity before starting persistence", async () => {
    const f = fixture();
    const gate = deferred();
    const occupied = Array.from({ length: 256 }, () =>
      f.permit.run(() => gate.promise),
    );
    try {
      expect(await f.run()).toBe(false);
      expect(f.options.persist).not.toHaveBeenCalled();
      expect(f.options.commit).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await Promise.all(occupied);
    }
  });

  it("revalidates a reentrant final workspace read before commit", async () => {
    const f = fixture();
    const read = f.options.readWorkspace.getMockImplementation();
    if (!read) throw new Error("Missing workspace reader");
    let reads = 0;
    f.options.readWorkspace.mockImplementation(() => {
      if (++reads === 3) f.seal();
      return read();
    });
    expect(await f.run()).toBe(false);
    expect(f.options.commit).not.toHaveBeenCalled();
  });

  it("passes the original authority through the persistence phases", async () => {
    const f = fixture();
    expect(
      await runSessionRemoval({
        ...f.options,
        persist: async (_session, isCurrent) => {
          expect(isCurrent()).toBe(true);
          f.seal();
          expect(isCurrent()).toBe(false);
        },
      }),
    ).toBe(false);
    expect(f.options.commit).not.toHaveBeenCalled();
  });

  it("commits a healthy action once with its original permit", async () => {
    const f = fixture();
    expect(await f.run()).toBe(true);
    expect(f.options.persist).toHaveBeenCalledOnce();
    expect(f.options.commit).toHaveBeenCalledOnce();
    const final = f.seal();
    expect(final.pending).toBeNull();
  });
});

describe("session removal batches", () => {
  it("does not readopt authority for later items after close cancellation", async () => {
    const f = fixture();
    const remove = vi.fn(async () => {
      f.seal().cancel();
      return true;
    });
    expect(
      await runSessionRemovalBatch({
        sessionIds: ["first", "second"],
        persistencePermit: f.permit,
        remove,
      }),
    ).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith("first", f.permit);
  });

  it("retains the original selection across pending removal", async () => {
    const f = fixture();
    const gate = deferred();
    const ids = ["first", "second"];
    const remove = vi.fn(async () => {
      await gate.promise;
      return true;
    });
    const pending = runSessionRemovalBatch({
      sessionIds: ids,
      persistencePermit: f.permit,
      remove,
    });
    ids.splice(0, ids.length, "replacement");
    gate.resolve();
    expect(await pending).toBe(true);
    expect(remove.mock.calls).toEqual([
      ["first", f.permit],
      ["second", f.permit],
    ]);
  });

  it("does not issue a removal under an already invalid permit", async () => {
    const f = fixture();
    f.seal();
    const remove = vi.fn(async () => true);
    expect(
      await runSessionRemovalBatch({
        sessionIds: ["first"],
        persistencePermit: f.permit,
        remove,
      }),
    ).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("stops the batch when a member declines removal", async () => {
    const f = fixture();
    const remove = vi.fn(async () => false);
    expect(
      await runSessionRemovalBatch({
        sessionIds: ["first", "second"],
        persistencePermit: f.permit,
        remove,
      }),
    ).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith("first", f.permit);
  });
});
