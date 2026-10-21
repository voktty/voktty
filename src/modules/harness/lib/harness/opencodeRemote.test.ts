import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireRemote: vi.fn(),
  captureRelease: vi.fn(),
  closeEvents: vi.fn(),
  abortSession: vi.fn(),
  clientOptions: undefined as unknown,
  event: undefined as ((value: Record<string, unknown>) => void) | undefined,
  eventFailure: undefined as ((message: string) => void) | undefined,
  eventError: undefined as string | undefined,
  invalidateRemote: vi.fn(),
  sessionLookups: [] as string[],
  refreshCatalog: vi.fn(),
  releaseRemote: vi.fn(),
  resolveBinary: vi.fn(),
}));

vi.mock("./child", () => ({
  closeHarnessSse: vi.fn(async () => undefined),
  execChild: vi.fn(),
  freeHarnessPort: vi.fn(),
  killChild: vi.fn(async () => undefined),
  resolveOpenCodeBinary: mocks.resolveBinary,
  spawnChild: vi.fn(),
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
}));

vi.mock("./opencodeClient", () => ({
  OpenCodeClient: class {
    readonly generation = "v2";

    constructor(
      baseUrl: string,
      directory: string,
      generation: string,
      password: string,
    ) {
      mocks.clientOptions = { baseUrl, directory, generation, password };
    }

    async createSession() {
      return { id: "opencode-remote-session", directory: "/srv/app" };
    }

    async getSession(sessionId: string) {
      mocks.sessionLookups.push(sessionId);
      return { id: sessionId, directory: "/srv/app" };
    }

    async updateSession() {}

    async subscribeEvents(
      _sessionId: string,
      onEvent: (value: Record<string, unknown>) => void,
      onError: (message: string) => void,
    ) {
      mocks.event = onEvent;
      mocks.eventFailure = onError;
    }

    async promptAsync() {
      queueMicrotask(() => {
        if (mocks.eventError) {
          mocks.eventFailure?.(mocks.eventError);
          return;
        }
        mocks.event?.({
          type: "session.idle",
          properties: { sessionID: "opencode-remote-session" },
        });
      });
      return undefined;
    }

    async abortSession() {
      await mocks.abortSession();
    }
    async closeEvents(sessionId: string) {
      await mocks.closeEvents(sessionId);
    }
  },
}));

vi.mock("./opencodeService", () => ({
  resolveOpenCodeV2Service: vi.fn(),
}));

vi.mock("./opencodeCatalog", () => ({
  refreshOpenCodeCatalog: mocks.refreshCatalog,
}));

vi.mock("./remoteOpenCodeService", () => ({
  acquireRemoteOpenCodeService: mocks.acquireRemote,
  captureRemoteOpenCodeServiceRelease: mocks.captureRelease,
  invalidateRemoteOpenCodeService: mocks.invalidateRemote,
  releaseRemoteOpenCodeService: mocks.releaseRemote,
}));

import {
  __openCodeTestReset,
  forgetOpenCodeSession,
  sendOpenCodeTurn,
  stopOpenCodeSession,
} from "./opencode";
import type { HarnessEvent } from "./types";

describe("remote OpenCode Harness binding", () => {
  beforeEach(() => {
    __openCodeTestReset();
    mocks.acquireRemote.mockReset().mockResolvedValue({
      url: "http://127.0.0.1:43123",
      password: "remote-secret",
      directory: "/srv/app",
      sessionId: 7,
    });
    mocks.abortSession.mockReset().mockResolvedValue(undefined);
    mocks.captureRelease.mockReset().mockImplementation((owner: string) => {
      const release = mocks.releaseRemote.getMockImplementation();
      return async () => {
        mocks.releaseRemote(owner);
        await release?.(owner);
      };
    });
    mocks.closeEvents.mockReset().mockResolvedValue(undefined);
    mocks.clientOptions = undefined;
    mocks.event = undefined;
    mocks.eventFailure = undefined;
    mocks.eventError = undefined;
    mocks.sessionLookups = [];
    mocks.invalidateRemote.mockReset().mockResolvedValue(undefined);
    mocks.refreshCatalog.mockReset().mockResolvedValue(undefined);
    mocks.releaseRemote.mockReset().mockResolvedValue(undefined);
    mocks.resolveBinary.mockReset();
  });

  afterEach(async () => {
    await stopOpenCodeSession("remote-thread");
  });

  it("uses the native SSH service, remote directory and loopback tunnel", async () => {
    const events: HarnessEvent[] = [];
    await sendOpenCodeTurn({
      sessionId: "remote-thread",
      cwd: "remote://env-1/srv/app",
      model: "opencode:openai/gpt-5.2",
      runtimeMode: "supervised",
      text: "Inspect this remote project",
      attachments: [],
      onEvent: (event) => events.push(event),
    });

    expect(mocks.resolveBinary).not.toHaveBeenCalled();
    expect(mocks.acquireRemote).toHaveBeenCalledWith(
      "remote-thread",
      "remote://env-1/srv/app",
    );
    expect(mocks.refreshCatalog).toHaveBeenCalledWith("remote://env-1/srv/app");
    expect(mocks.clientOptions).toEqual({
      baseUrl: "http://127.0.0.1:43123",
      directory: "/srv/app",
      generation: "v2",
      password: "remote-secret",
    });
    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "opencode-remote-session",
    });
    expect(events).toContainEqual({ type: "session.started" });

    await stopOpenCodeSession("remote-thread");
    expect(mocks.releaseRemote).toHaveBeenCalledWith("remote-thread");
  });

  it("reopens the native tunnel and resumes the provider session after parking", async () => {
    mocks.acquireRemote
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:43123",
        password: "remote-secret",
        directory: "/srv/app",
        sessionId: 7,
      })
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:43124",
        password: "remote-secret",
        directory: "/srv/app",
        sessionId: 8,
      });
    const events: HarnessEvent[] = [];
    const input = {
      sessionId: "remote-thread",
      cwd: "remote://env-1/srv/app",
      model: "opencode:openai/gpt-5.2",
      runtimeMode: "supervised" as const,
      text: "Continue this remote project",
      attachments: [],
      onEvent: (event: HarnessEvent) => events.push(event),
    };

    await sendOpenCodeTurn(input);
    await stopOpenCodeSession("remote-thread");
    await sendOpenCodeTurn(input);

    expect(mocks.acquireRemote).toHaveBeenCalledTimes(2);
    expect(mocks.sessionLookups).toEqual(["opencode-remote-session"]);
    expect(mocks.clientOptions).toMatchObject({
      baseUrl: "http://127.0.0.1:43124",
      directory: "/srv/app",
    });
    expect(
      events.filter((event) => event.type === "session.providerBound"),
    ).toEqual([
      {
        type: "session.providerBound",
        providerSessionId: "opencode-remote-session",
      },
      {
        type: "session.providerBound",
        providerSessionId: "opencode-remote-session",
      },
    ]);
  });

  it("invalidates the native SSH session after a lost event stream and resumes on retry", async () => {
    mocks.acquireRemote
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:43123",
        password: "remote-secret",
        directory: "/srv/app",
        sessionId: 7,
      })
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:43124",
        password: "remote-secret",
        directory: "/srv/app",
        sessionId: 8,
      });
    const events: HarnessEvent[] = [];
    const input = {
      sessionId: "remote-thread",
      cwd: "remote://env-1/srv/app",
      model: "opencode:openai/gpt-5.2",
      runtimeMode: "supervised" as const,
      text: "Continue this remote project",
      attachments: [],
      onEvent: (event: HarnessEvent) => events.push(event),
    };
    mocks.eventError = "SSH tunnel closed";

    await expect(sendOpenCodeTurn(input)).rejects.toThrow("SSH tunnel closed");
    expect(mocks.invalidateRemote).toHaveBeenCalledWith("remote-thread");

    mocks.eventError = undefined;
    await sendOpenCodeTurn(input);

    expect(mocks.acquireRemote).toHaveBeenCalledTimes(2);
    expect(mocks.sessionLookups).toEqual(["opencode-remote-session"]);
    expect(mocks.clientOptions).toMatchObject({
      baseUrl: "http://127.0.0.1:43124",
      directory: "/srv/app",
    });
    expect(
      events.filter((event) => event.type === "session.providerBound"),
    ).toEqual([
      {
        type: "session.providerBound",
        providerSessionId: "opencode-remote-session",
      },
      {
        type: "session.providerBound",
        providerSessionId: "opencode-remote-session",
      },
    ]);
  });

  it("releases the native SSH session when closing hits a tunnel error", async () => {
    await sendOpenCodeTurn({
      sessionId: "remote-thread",
      cwd: "remote://env-1/srv/app",
      model: "opencode:openai/gpt-5.2",
      runtimeMode: "supervised",
      text: "Inspect this remote project",
      attachments: [],
      onEvent: () => undefined,
    });
    mocks.abortSession.mockRejectedValue(new Error("tunnel closed"));

    await expect(stopOpenCodeSession("remote-thread")).rejects.toThrow(
      "tunnel closed",
    );
    expect(mocks.releaseRemote).toHaveBeenCalledWith("remote-thread");
  });

  it.each(["resolve", "reject"])(
    "captures pending SSH service A before forget and late %s cannot release B",
    async (outcome) => {
      let resolve!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      const pending = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      mocks.acquireRemote.mockImplementationOnce(() => pending);
      const releaseA = vi.fn(async () => undefined);
      const releaseB = vi.fn(async () => undefined);
      mocks.captureRelease
        .mockReturnValueOnce(releaseA)
        .mockReturnValueOnce(releaseB);
      const eventsA: HarnessEvent[] = [];
      const makeInput = (events: HarnessEvent[]) => ({
        sessionId: "remote-thread",
        cwd: "remote://env-1/srv/app",
        model: "opencode:openai/gpt-5.2",
        runtimeMode: "supervised" as const,
        text: "inspect",
        attachments: [],
        onEvent: (event: HarnessEvent) => events.push(event),
      });
      const a = sendOpenCodeTurn(makeInput(eventsA)).catch((error) => error);
      await forgetOpenCodeSession("remote-thread");
      expect(mocks.captureRelease).toHaveBeenCalledWith("remote-thread");
      expect(releaseA).not.toHaveBeenCalled();
      const eventsB: HarnessEvent[] = [];
      await sendOpenCodeTurn(makeInput(eventsB));
      if (outcome === "resolve")
        resolve({
          url: "http://127.0.0.1:43123",
          password: "test",
          directory: "/srv/app",
          sessionId: 7,
        });
      else reject(new Error("late SSH service failure"));
      await a;
      expect(eventsA).toEqual([]);
      expect(releaseA).toHaveBeenCalledOnce();
      expect(releaseB).not.toHaveBeenCalled();
      expect(mocks.sessionLookups).toEqual([]);
      expect(eventsB).toContainEqual({ type: "session.started" });
      await stopOpenCodeSession("remote-thread");
      expect(releaseB).toHaveBeenCalledOnce();
    },
  );

  it("captures service release and SSE before deferred abort, including abort rejection", async () => {
    const input = {
      sessionId: "remote-thread",
      cwd: "remote://env-1/srv/app",
      model: "opencode:openai/gpt-5.2",
      runtimeMode: "supervised" as const,
      text: "inspect",
      attachments: [],
      onEvent: () => undefined,
    };
    await sendOpenCodeTurn(input);
    let reject!: (error: Error) => void;
    mocks.abortSession.mockImplementationOnce(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    const releaseA = vi.fn(async () => undefined);
    const releaseB = vi.fn(async () => undefined);
    mocks.captureRelease
      .mockReturnValueOnce(releaseA)
      .mockReturnValueOnce(releaseB);
    const stopped = forgetOpenCodeSession("remote-thread").catch(
      (error) => error,
    );
    expect(mocks.captureRelease).toHaveBeenCalledOnce();
    expect(mocks.closeEvents).toHaveBeenCalledOnce();
    const streamA = mocks.closeEvents.mock.calls[0][0];
    await sendOpenCodeTurn(input);
    expect(releaseA).not.toHaveBeenCalled();
    reject(new Error("tunnel abort rejected"));
    expect(await stopped).toMatchObject({ message: "tunnel abort rejected" });
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseB).not.toHaveBeenCalled();
    expect(mocks.closeEvents.mock.calls.map((call) => call[0])).toEqual([
      streamA,
    ]);
    await stopOpenCodeSession("remote-thread");
    expect(releaseB).toHaveBeenCalledOnce();
  });

  it("keeps the captured SSH tunnel until abort ACK while B is admitted behind the resume barrier", async () => {
    const input = {
      sessionId: "remote-thread",
      cwd: "remote://env-1/srv/app",
      model: "opencode:openai/gpt-5.2",
      runtimeMode: "supervised" as const,
      text: "",
      attachments: [],
      onEvent: () => undefined,
    };
    await sendOpenCodeTurn(input);
    let acknowledge!: () => void;
    mocks.abortSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const releaseA = vi.fn(async () => undefined);
    const releaseB = vi.fn(async () => undefined);
    mocks.captureRelease
      .mockReturnValueOnce(releaseA)
      .mockReturnValueOnce(releaseB);
    const stopped = stopOpenCodeSession("remote-thread");
    const b = sendOpenCodeTurn(input);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(mocks.acquireRemote).toHaveBeenCalledTimes(2);
    expect(mocks.captureRelease).toHaveBeenCalledOnce();
    expect(releaseA).not.toHaveBeenCalled();
    expect(mocks.sessionLookups).toEqual([]);
    acknowledge();
    await stopped;
    await b;
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseB).not.toHaveBeenCalled();
    expect(mocks.sessionLookups).toEqual(["opencode-remote-session"]);
  });

  it("invalidates captured SSH ownership before an error sink reentrantly starts B", async () => {
    const input = {
      sessionId: "remote-thread",
      cwd: "remote://env-1/srv/app",
      model: "opencode:openai/gpt-5.2",
      runtimeMode: "supervised" as const,
      text: "inspect",
      attachments: [],
      onEvent: () => undefined,
    };
    let replacement: Promise<void> | undefined;
    await sendOpenCodeTurn({
      ...input,
      onEvent: (event) => {
        if (event.type === "session.error")
          replacement = sendOpenCodeTurn(input);
      },
    });
    const staleFailure = mocks.eventFailure;
    staleFailure?.("SSH stream lost");
    await replacement;
    expect(mocks.acquireRemote).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateRemote).toHaveBeenCalledOnce();
    expect(mocks.invalidateRemote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acquireRemote.mock.invocationCallOrder[1],
    );
    expect(mocks.captureRelease).not.toHaveBeenCalled();
    staleFailure?.("late old failure");
    expect(mocks.invalidateRemote).toHaveBeenCalledOnce();
    await sendOpenCodeTurn(input);
    expect(mocks.acquireRemote).toHaveBeenCalledTimes(2);
  });
});
