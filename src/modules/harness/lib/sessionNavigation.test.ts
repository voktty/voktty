import { describe, expect, it, vi } from "vitest";
import { openSessionNavigation } from "@/modules/harness/lib/sessionNavigation";
import {
  createPersistenceAdmission,
  type PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import { newSession, type Session } from "@/modules/harness/lib/session";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing session navigation fixture");
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const authority = createPersistenceAdmission();
  const owner = authority.createOwner();
  const host = authority.createOwner();
  const session = { ...newSession("claude", "/project"), id: "target" };
  const begin = vi.fn(() => {});
  const load = vi
    .fn<(id: string, permit: PersistencePermit) => Promise<Session | null>>()
    .mockResolvedValue(session);
  const commit = vi.fn((_session: Session, _permit: PersistencePermit) => true);
  const input = { sessionId: session.id, owner, begin, load, commit };
  return { authority, owner, host, session, begin, load, commit, input };
}

describe("session navigation confirmation", () => {
  it("loads under the original view permit and confirms a current commit", async () => {
    const f = fixture();
    expect(await openSessionNavigation(f.input)).toBe(true);
    expect(f.begin).toHaveBeenCalledOnce();
    expect(f.load).toHaveBeenCalledWith(
      "target",
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    );
    expect(f.commit).toHaveBeenCalledWith(f.session, f.load.mock.calls[0][1]);
  });

  it.each([
    null,
    { ...newSession("codex", "remote://machine/project"), id: "different" },
  ])(
    "does not confirm missing or mismatched session data: %s",
    async (session) => {
      const f = fixture();
      f.load.mockResolvedValue(session);
      expect(await openSessionNavigation(f.input)).toBe(false);
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it("does not borrow a live host's authority after its view retires", async () => {
    const f = fixture();
    const request = required(f.host.capture());
    f.owner.retire();
    expect(request.isCurrent()).toBe(true);
    expect(await openSessionNavigation({ ...f.input, request })).toBe(false);
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
  });

  it.each(["view", "request", "close cancellation"] as const)(
    "rejects a late load after %s retirement",
    async (retirement) => {
      const f = fixture();
      const gate = deferred<Session | null>();
      f.load.mockReturnValue(gate.promise);
      const request = required(f.host.capture());
      const pending = openSessionNavigation({ ...f.input, request });
      const captured = f.load.mock.calls[0][1];
      if (retirement === "view") f.owner.retire();
      if (retirement === "request") f.host.retire();
      if (retirement === "close cancellation") {
        const closer = f.authority.createOwner();
        required(required(closer.capture()).seal()).cancel();
      }
      const write = vi.fn(async () => {});
      expect(await captured.run(write)).toBe(false);
      expect(write).not.toHaveBeenCalled();
      gate.resolve(f.session);
      expect(await pending).toBe(false);
      expect(f.commit).not.toHaveBeenCalled();
    },
  );

  it("checks admission again after the navigation-start callback", async () => {
    const f = fixture();
    f.begin.mockImplementation(() => f.owner.retire());
    expect(await openSessionNavigation(f.input)).toBe(false);
    expect(f.load).not.toHaveBeenCalled();
  });

  it("does not use a fresh owner when a retired load settles", async () => {
    const f = fixture();
    const gate = deferred<Session | null>();
    f.load.mockReturnValueOnce(gate.promise);
    const pending = openSessionNavigation(f.input);
    f.owner.retire();
    const replacement = f.authority.createOwner();
    gate.resolve(f.session);
    expect(await pending).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
    expect(
      await openSessionNavigation({ ...f.input, owner: replacement }),
    ).toBe(true);
  });

  it("does not confirm a declined commit or one that retires the view", async () => {
    const f = fixture();
    f.commit.mockReturnValueOnce(false);
    expect(await openSessionNavigation(f.input)).toBe(false);
    f.commit.mockImplementationOnce(() => {
      f.owner.retire();
      return true;
    });
    expect(await openSessionNavigation(f.input)).toBe(false);
  });

  it("keeps read-only loading outside write receipts", async () => {
    const f = fixture();
    const gate = deferred<Session | null>();
    f.load.mockReturnValueOnce(gate.promise);
    const pending = openSessionNavigation(f.input);
    const closer = f.authority.createOwner();
    const final = required(required(closer.capture()).seal());
    expect(final.pending).toBeNull();
    gate.resolve(f.session);
    expect(await pending).toBe(false);
  });

  it("retains admitted loader writes in the close drain without granting seal", async () => {
    const f = fixture();
    const gate = deferred<void>();
    f.load.mockImplementationOnce(async (_id, permit) => {
      expect(permit.seal()).toBeNull();
      await permit.run(() => gate.promise);
      return f.session;
    });
    const pending = openSessionNavigation(f.input);
    const closer = f.authority.createOwner();
    const final = required(required(closer.capture()).seal());
    expect(final.pending).not.toBeNull();
    gate.resolve();
    await final.pending;
    expect(await pending).toBe(false);
  });

  it("preserves a current loader failure but suppresses a retired one", async () => {
    const f = fixture();
    const error = new Error("Load failed");
    f.load.mockRejectedValueOnce(error);
    await expect(openSessionNavigation(f.input)).rejects.toBe(error);
    const gate = deferred<Session | null>();
    f.load.mockReturnValueOnce(gate.promise);
    const pending = openSessionNavigation(f.input);
    f.owner.retire();
    gate.reject(error);
    expect(await pending).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
  });
});
