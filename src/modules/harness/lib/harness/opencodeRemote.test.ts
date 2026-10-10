import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireRemote: vi.fn(),
  abortSession: vi.fn(),
  clientOptions: undefined as unknown,
  event: undefined as ((value: Record<string, unknown>) => void) | undefined,
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
    ) {
      mocks.event = onEvent;
    }

    async promptAsync() {
      queueMicrotask(() => {
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
    async closeEvents() {}
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
  releaseRemoteOpenCodeService: mocks.releaseRemote,
}));

import {
  __openCodeTestReset,
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
    mocks.clientOptions = undefined;
    mocks.event = undefined;
    mocks.sessionLookups = [];
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
});
