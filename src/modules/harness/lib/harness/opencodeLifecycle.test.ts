import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { OpenCodeClient } from "./opencodeClient";
import type { HarnessEvent, SendTurnInput } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  version: "opencode 1.14.19",
  resolveBinary: vi.fn(),
  spawn: vi.fn(),
  openSse: vi.fn(),
  service: vi.fn(),
  http: vi.fn(),
  abort: vi.fn(),
  kill: vi.fn(async (_id: string) => undefined),
  close: vi.fn(async (_id: string) => undefined),
  unwatch: vi.fn(),
  children: new Map<
    string,
    { stdout: (line: string) => void; exit: (code: number | null) => void }
  >(),
  streams: new Map<
    string,
    { data: (data: string) => void; end?: (error?: string) => void }
  >(),
  nextSession: 0,
}));

vi.mock("./child", () => ({
  resolveOpenCodeBinary: mocks.resolveBinary,
  execChild: async () => mocks.version,
  freeHarnessPort: async () => 4096,
  spawnChild: mocks.spawn,
  killChild: mocks.kill,
  unwatchChild: mocks.unwatch,
  watchChild: (
    id: string,
    stdout: (line: string) => void,
    exit: (code: number | null) => void,
  ) => {
    mocks.children.set(id, { stdout, exit });
  },
  harnessHttp: mocks.http,
  openHarnessSse: mocks.openSse,
  closeHarnessSse: mocks.close,
  watchSse: (
    id: string,
    data: (data: string) => void,
    end?: (error?: string) => void,
  ) => {
    mocks.streams.set(id, { data, end });
  },
}));
vi.mock("./opencodeService", () => ({
  resolveOpenCodeV2Service: mocks.service,
}));
vi.mock("./remoteOpenCodeService", () => ({
  acquireRemoteOpenCodeService: vi.fn(),
  captureRemoteOpenCodeServiceRelease: () => async () => undefined,
  invalidateRemoteOpenCodeService: vi.fn(async () => undefined),
  releaseRemoteOpenCodeService: vi.fn(async () => undefined),
}));

import {
  __openCodeTestReset,
  bindOpenCodeSession,
  cancelOpenCodeTurn,
  compactOpenCodeContext,
  forgetOpenCodeSession,
  rewindOpenCodeLastTurn,
  sendOpenCodeTurn,
  steerOpenCodeTurn,
  stopOpenCodeSession,
} from "./opencode";

const drain = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
const input = (
  events: HarnessEvent[] = [],
  id = "same-thread",
): SendTurnInput => ({
  sessionId: id,
  cwd: "/repo",
  model: "opencode:openai/gpt-5",
  runtimeMode: "supervised",
  text: "",
  attachments: [],
  onEvent: (event) => events.push(event),
});
function httpImplementation() {
  const implementation = mocks.http.getMockImplementation();
  if (!implementation) throw new Error("HTTP fixture is not installed");
  return implementation;
}

const response = (id: string) => ({
  status: 200,
  body: JSON.stringify({ id, directory: "/repo" }),
});

beforeEach(() => {
  __openCodeTestReset();
  mocks.version = "opencode 1.14.19";
  mocks.nextSession = 0;
  mocks.children.clear();
  mocks.streams.clear();
  mocks.resolveBinary.mockReset().mockResolvedValue({ path: "/fake/opencode" });
  mocks.spawn.mockReset().mockImplementation(async (id: string) => {
    mocks.children
      .get(id)
      ?.stdout("opencode server listening on http://127.0.0.1:4096");
  });
  mocks.kill.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.unwatch.mockClear();
  mocks.openSse.mockReset().mockResolvedValue(undefined);
  mocks.service.mockReset().mockResolvedValue({
    url: "http://127.0.0.1:4096",
    directory: "/repo",
    password: "test",
  });
  mocks.abort.mockReset().mockResolvedValue({ status: 204, body: "" });
  mocks.http
    .mockReset()
    .mockImplementation(async (request: { url: string; method: string }) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/abort") || path.endsWith("/interrupt"))
        return mocks.abort();
      if (
        request.method === "POST" &&
        (path === "/session" || path === "/api/session")
      )
        return response(`provider-${++mocks.nextSession}`);
      if (request.method === "GET" && path.includes("/session/"))
        return response(path.split("/").pop() ?? "");
      return { status: 204, body: "" };
    });
});

afterEach(() => {
  vi.restoreAllMocks();
  __openCodeTestReset();
});

it.each(["resolve", "reject"])(
  "forgets pending binary A then admits B without A %s reviving or killing B",
  async (outcome) => {
    const binary = deferred<{ path: string }>();
    mocks.resolveBinary.mockImplementationOnce(() => binary.promise);
    const eventsA: HarnessEvent[] = [];
    const a = sendOpenCodeTurn(input(eventsA)).catch((error) => error);
    const stopped = forgetOpenCodeSession("same-thread");
    await stopped;
    const eventsB: HarnessEvent[] = [];
    await sendOpenCodeTurn(input(eventsB));
    const nativeB = mocks.spawn.mock.calls[0][0];
    if (outcome === "resolve") binary.resolve({ path: "/fake/opencode" });
    else binary.reject(new Error("late resolver failure"));
    await a;
    await stopped;
    expect(eventsA).toEqual([]);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(nativeB).not.toBe("same-thread");
    expect(mocks.kill).not.toHaveBeenCalledWith(nativeB);
    expect(mocks.unwatch).not.toHaveBeenCalledWith(nativeB);
    expect(mocks.close).not.toHaveBeenCalledWith(nativeB, expect.anything());
    await stopOpenCodeSession("same-thread");
    await sendOpenCodeTurn(input());
    expect(
      mocks.http.mock.calls.some(
        ([request]) =>
          request.method === "GET" &&
          new URL(request.url).pathname.endsWith("/provider-1"),
      ),
    ).toBe(true);
  },
);

it.each(["resolve", "reject"])(
  "cleans only captured A after deferred spawn %s and replacement B",
  async (outcome) => {
    const spawned = deferred<void>();
    mocks.spawn.mockImplementationOnce((id: string) => {
      mocks.children
        .get(id)
        ?.stdout("opencode server listening on http://127.0.0.1:4096");
      return spawned.promise;
    });
    const eventsA: HarnessEvent[] = [];
    const a = sendOpenCodeTurn(input(eventsA)).catch((error) => error);
    await drain();
    const nativeA = mocks.spawn.mock.calls[0][0];
    const stopped = forgetOpenCodeSession("same-thread");
    await stopped;
    await sendOpenCodeTurn(input());
    const nativeB = mocks.spawn.mock.calls[1][0];
    if (outcome === "resolve") spawned.resolve();
    else spawned.reject(new Error("late spawn failure"));
    await a;
    await stopped;
    expect(nativeA).not.toBe(nativeB);
    expect(mocks.kill).toHaveBeenCalledWith(nativeA);
    expect(mocks.kill).not.toHaveBeenCalledWith(nativeB);
    expect(eventsA).toEqual([]);
  },
);

it("closes captured client SSE even when abort rejects and B replaces A", async () => {
  await sendOpenCodeTurn(input());
  const nativeA = mocks.spawn.mock.calls[0][0];
  const abort = deferred<void>();
  vi.spyOn(OpenCodeClient.prototype, "abortSession").mockImplementationOnce(
    () => abort.promise,
  );
  const stopped = forgetOpenCodeSession("same-thread").catch((error) => error);
  await sendOpenCodeTurn(input());
  const nativeB = mocks.spawn.mock.calls[1][0];
  abort.reject(new Error("abort rejected"));
  expect(await stopped).toMatchObject({ message: "abort rejected" });
  expect(mocks.close.mock.calls.map((call) => call[0])).toContain(nativeA);
  expect(mocks.close.mock.calls.map((call) => call[0])).not.toContain(nativeB);
  expect(mocks.kill).toHaveBeenCalledWith(nativeA);
  expect(mocks.kill).not.toHaveBeenCalledWith(nativeB);
});

it("cold resume-only forget never kills or unwatches a borrowed logical child", async () => {
  bindOpenCodeSession("same-thread", "persisted", "/repo");
  await forgetOpenCodeSession("same-thread");
  expect(mocks.kill).not.toHaveBeenCalled();
  expect(mocks.unwatch).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("current live exit uses the new turn sink and stale exit cannot retire B", async () => {
  const old: HarnessEvent[] = [];
  const current: HarnessEvent[] = [];
  await sendOpenCodeTurn(input(old));
  const nativeA = mocks.spawn.mock.calls[0][0];
  await sendOpenCodeTurn(input(current));
  mocks.children.get(nativeA)?.exit(7);
  expect(current).toContainEqual({ type: "session.ended", code: 7 });
  expect(old).not.toContainEqual({ type: "session.ended", code: 7 });
  await sendOpenCodeTurn(input());
  const nativeB = mocks.spawn.mock.calls[1][0];
  mocks.children.get(nativeA)?.exit(9);
  await sendOpenCodeTurn(input());
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  expect(mocks.kill).not.toHaveBeenCalledWith(nativeB);
});

it("counts cancelled pending operations until settlement at the 256 owner limit", async () => {
  const binary = deferred<{ path: string }>();
  mocks.resolveBinary.mockImplementation(() => binary.promise);
  const pending = Array.from({ length: 256 }, (_, index) =>
    sendOpenCodeTurn(input([], `thread-${index}`)).catch((error) => error),
  );
  const cleanup = Array.from({ length: 256 }, (_, index) =>
    forgetOpenCodeSession(`thread-${index}`),
  );
  await expect(sendOpenCodeTurn(input([], "overflow"))).rejects.toThrow(
    "CAPACITY",
  );
  expect(mocks.resolveBinary).toHaveBeenCalledTimes(256);
  binary.resolve({ path: "/fake/opencode" });
  await Promise.all(pending);
  await Promise.all(cleanup);
  expect(mocks.spawn).not.toHaveBeenCalled();
  mocks.resolveBinary.mockResolvedValue({ path: "/fake/opencode" });
  await sendOpenCodeTurn(input([], "admitted"));
});

it.each(["v1", "v2"])(
  "never publishes or recreates a forgotten %s getSession after late 404",
  async (generation) => {
    if (generation === "v2") mocks.version = "opencode v2.0.19";
    const lookup = deferred<{ status: number; body: string }>();
    bindOpenCodeSession("same-thread", "persisted-A", "/repo");
    const original = httpImplementation();
    mocks.http.mockImplementation(
      (request: { url: string; method: string }) => {
        if (
          request.method === "GET" &&
          new URL(request.url).pathname.endsWith("/persisted-A")
        )
          return lookup.promise;
        return original(request);
      },
    );
    const eventsA: HarnessEvent[] = [];
    const a = sendOpenCodeTurn(input(eventsA)).catch((error) => error);
    await drain();
    await forgetOpenCodeSession("same-thread");
    const eventsB: HarnessEvent[] = [];
    await sendOpenCodeTurn(input(eventsB));
    lookup.resolve({ status: 404, body: "{}" });
    await a;
    expect(eventsA).toEqual([]);
    expect(mocks.nextSession).toBe(1);
    const streamIds = [...mocks.streams.keys()];
    const nativeB = streamIds[streamIds.length - 1];
    expect(nativeB).toBeDefined();
    expect(mocks.close.mock.calls.map((call) => call[0])).not.toContain(
      nativeB,
    );
    await stopOpenCodeSession("same-thread");
    await sendOpenCodeTurn(input());
    expect(
      mocks.http.mock.calls.filter(
        ([request]) =>
          request.method === "GET" &&
          new URL(request.url).pathname.endsWith("/provider-1"),
      ),
    ).toHaveLength(1);
  },
);

it.each(["resolve", "reject"])(
  "retires pending createSession A without stale resume on %s",
  async (outcome) => {
    const created = deferred<{ status: number; body: string }>();
    const original = httpImplementation();
    let first = true;
    mocks.http.mockImplementation(
      (request: { url: string; method: string }) => {
        if (
          first &&
          request.method === "POST" &&
          new URL(request.url).pathname === "/session"
        ) {
          first = false;
          return created.promise;
        }
        return original(request);
      },
    );
    const eventsA: HarnessEvent[] = [];
    const a = sendOpenCodeTurn(input(eventsA)).catch((error) => error);
    await drain();
    await forgetOpenCodeSession("same-thread");
    await sendOpenCodeTurn(input());
    if (outcome === "resolve") created.resolve(response("stale-A"));
    else created.reject(new Error("late create failed"));
    await a;
    expect(eventsA).toEqual([]);
    expect(mocks.streams.size).toBe(1);
    await stopOpenCodeSession("same-thread");
    await sendOpenCodeTurn(input());
    expect(
      mocks.http.mock.calls.some(([request]) =>
        request.url.includes("stale-A"),
      ),
    ).toBe(false);
  },
);

it.each(["resolve", "reject"])(
  "closes exact pending SSE initialization A after %s without closing B",
  async (outcome) => {
    const opened = deferred<void>();
    mocks.openSse.mockImplementationOnce(() => opened.promise);
    const eventsA: HarnessEvent[] = [];
    const a = sendOpenCodeTurn(input(eventsA)).catch((error) => error);
    await drain();
    const nativeA = [...mocks.streams.keys()][0];
    await forgetOpenCodeSession("same-thread");
    await sendOpenCodeTurn(input());
    const nativeB = [...mocks.streams.keys()][1];
    if (outcome === "resolve") opened.resolve();
    else opened.reject(new Error("late SSE open failed"));
    await a;
    expect(nativeA).not.toBe(nativeB);
    expect(mocks.close.mock.calls.map((call) => call[0])).toContain(nativeA);
    expect(mocks.close.mock.calls.map((call) => call[0])).not.toContain(
      nativeB,
    );
    expect(eventsA).toEqual([]);
  },
);

it("keeps local singleton v2 service startup owned while A retires and B succeeds", async () => {
  mocks.version = "opencode v2.0.19";
  const service = deferred<{
    url: string;
    directory: string;
    password: string;
  }>();
  mocks.service.mockImplementationOnce(() => service.promise);
  const eventsA: HarnessEvent[] = [];
  const a = sendOpenCodeTurn(input(eventsA)).catch((error) => error);
  await drain();
  await forgetOpenCodeSession("same-thread");
  await sendOpenCodeTurn(input());
  service.resolve({
    url: "http://127.0.0.1:4096",
    directory: "/repo",
    password: "test",
  });
  await a;
  expect(eventsA).toEqual([]);
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.kill).not.toHaveBeenCalled();
  expect(mocks.streams.size).toBe(1);
});

it("preserves fast PID exit before spawn resolves without publishing a live session", async () => {
  mocks.spawn.mockImplementationOnce(async (id: string) => {
    mocks.children
      .get(id)
      ?.stdout("opencode server listening on http://127.0.0.1:4096");
    mocks.children.get(id)?.exit(5);
  });
  const events: HarnessEvent[] = [];
  await expect(sendOpenCodeTurn(input(events))).rejects.toThrow("cancelled");
  expect(events).toEqual([{ type: "session.ended", code: 5 }]);
  expect(mocks.http).not.toHaveBeenCalled();
  expect(mocks.kill).toHaveBeenCalledWith(mocks.spawn.mock.calls[0][0]);
});

it("retains failed cleanup reservation addressably until exact native cleanup retries", async () => {
  await sendOpenCodeTurn(input());
  const nativeA = mocks.spawn.mock.calls[0][0];
  mocks.kill.mockRejectedValueOnce(new Error("native kill uncertain"));
  await expect(stopOpenCodeSession("same-thread")).rejects.toThrow(
    "native kill uncertain",
  );
  const binary = deferred<{ path: string }>();
  mocks.resolveBinary.mockImplementation(() => binary.promise);
  const pending = Array.from({ length: 255 }, (_, index) =>
    sendOpenCodeTurn(input([], `other-${index}`)).catch((error) => error),
  );
  await expect(sendOpenCodeTurn(input([], "overflow"))).rejects.toThrow(
    "CAPACITY",
  );
  await stopOpenCodeSession("same-thread");
  expect(mocks.kill.mock.calls.map((call) => call[0])).toEqual([
    nativeA,
    nativeA,
  ]);
  const admitted = sendOpenCodeTurn(input([], "overflow")).catch(
    (error) => error,
  );
  const cleanup = Array.from({ length: 255 }, (_, index) =>
    forgetOpenCodeSession(`other-${index}`),
  );
  await forgetOpenCodeSession("overflow");
  binary.resolve({ path: "/fake/opencode" });
  await Promise.all(pending);
  await admitted;
  await Promise.all(cleanup);
});

it("returns native stop ACK while a cancelled prompt still holds its bounded reservation", async () => {
  const prompt = deferred<{ status: number; body: string }>();
  const original = httpImplementation();
  mocks.http.mockImplementation((request: { url: string; method: string }) => {
    if (new URL(request.url).pathname.endsWith("/prompt_async"))
      return prompt.promise;
    return original(request);
  });
  const accepted = vi.fn();
  const a = sendOpenCodeTurn({
    ...input(),
    text: "wait",
    onAccepted: accepted,
  });
  await drain();
  await stopOpenCodeSession("same-thread");
  expect(mocks.kill).toHaveBeenCalledOnce();
  const binary = deferred<{ path: string }>();
  mocks.resolveBinary.mockImplementation(() => binary.promise);
  const pending = Array.from({ length: 255 }, (_, index) =>
    sendOpenCodeTurn(input([], `held-${index}`)).catch((error) => error),
  );
  await expect(sendOpenCodeTurn(input([], "overflow"))).rejects.toThrow(
    "CAPACITY",
  );
  prompt.resolve({ status: 204, body: "" });
  await a;
  await drain();
  expect(accepted).not.toHaveBeenCalled();
  const admitted = sendOpenCodeTurn(input([], "overflow")).catch(
    (error) => error,
  );
  await forgetOpenCodeSession("overflow");
  await Promise.all(
    Array.from({ length: 255 }, (_, index) =>
      forgetOpenCodeSession(`held-${index}`),
    ),
  );
  binary.resolve({ path: "/fake/opencode" });
  await admitted;
  await Promise.all(pending);
});

it("rejects cwd replacement at full capacity without retiring the admitted owner", async () => {
  await sendOpenCodeTurn(input());
  await Promise.all(
    Array.from({ length: 255 }, (_, index) =>
      sendOpenCodeTurn(input([], `full-${index}`)),
    ),
  );
  const nativeA = mocks.spawn.mock.calls[0][0];
  await expect(sendOpenCodeTurn({ ...input(), cwd: "/other" })).rejects.toThrow(
    "CAPACITY",
  );
  expect(mocks.kill).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  await sendOpenCodeTurn(input());
  expect(mocks.spawn).toHaveBeenCalledTimes(256);
  expect(mocks.kill).not.toHaveBeenCalledWith(nativeA);
  await stopOpenCodeSession("same-thread");
  await Promise.all(
    Array.from({ length: 255 }, (_, index) =>
      stopOpenCodeSession(`full-${index}`),
    ),
  );
});

it("tracks an in-flight automatic approval reply until settlement after native stop", async () => {
  const replied = deferred<{ status: number; body: string }>();
  const original = httpImplementation();
  mocks.http.mockImplementation((request: { url: string; method: string }) => {
    if (new URL(request.url).pathname.includes("/permission/"))
      return replied.promise;
    return original(request);
  });
  await sendOpenCodeTurn({ ...input(), runtimeMode: "full-access" });
  const nativeA = [...mocks.streams.keys()][0];
  mocks.streams.get(nativeA)?.data(
    JSON.stringify({
      type: "permission.asked",
      properties: {
        sessionID: "provider-1",
        id: "approve-A",
        permission: "read",
      },
    }),
  );
  await stopOpenCodeSession("same-thread");
  const binary = deferred<{ path: string }>();
  mocks.resolveBinary.mockImplementation(() => binary.promise);
  const pending = Array.from({ length: 255 }, (_, index) =>
    sendOpenCodeTurn(input([], `reply-${index}`)).catch((error) => error),
  );
  await expect(sendOpenCodeTurn(input([], "overflow"))).rejects.toThrow(
    "CAPACITY",
  );
  replied.resolve({ status: 204, body: "" });
  await drain();
  const admitted = sendOpenCodeTurn(input([], "overflow")).catch(
    (error) => error,
  );
  await forgetOpenCodeSession("overflow");
  await Promise.all(
    Array.from({ length: 255 }, (_, index) =>
      forgetOpenCodeSession(`reply-${index}`),
    ),
  );
  binary.resolve({ path: "/fake/opencode" });
  await admitted;
  await Promise.all(pending);
});

it.each(["prompt", "compact"])(
  "drains old guarded %s configuration before B resumes the same provider session",
  async (operation) => {
    mocks.version = "opencode v2.0.19";
    await sendOpenCodeTurn(input());
    const configured = deferred<{ status: number; body: string }>();
    const original = httpImplementation();
    let held = true;
    mocks.http.mockImplementation(
      (request: { url: string; method: string }) => {
        if (held && new URL(request.url).pathname.endsWith("/model")) {
          held = false;
          return configured.promise;
        }
        return original(request);
      },
    );
    const a = (
      operation === "prompt"
        ? sendOpenCodeTurn({ ...input(), text: "old turn" })
        : compactOpenCodeContext({
            sessionId: "same-thread",
            cwd: "/repo",
            model: "opencode:openai/gpt-5",
            runtimeMode: "supervised",
            onEvent: () => undefined,
          })
    ).catch((error) => error);
    await drain();
    await stopOpenCodeSession("same-thread");
    const b = sendOpenCodeTurn({ ...input(), text: "new turn" });
    await drain();
    expect(
      mocks.http.mock.calls.filter(([request]) => request.method === "GET"),
    ).toHaveLength(0);
    configured.resolve({ status: 204, body: "" });
    await a;
    await drain();
    const streamIds = [...mocks.streams.keys()];
    mocks.streams.get(streamIds[streamIds.length - 1])?.data(
      JSON.stringify({
        id: "evt_success",
        type: "session.execution.succeeded",
        data: { sessionID: "provider-1" },
      }),
    );
    await b;
    expect(
      mocks.http.mock.calls.filter(([request]) =>
        new URL(request.url).pathname.endsWith("/prompt"),
      ),
    ).toHaveLength(1);
    expect(
      mocks.http.mock.calls.some(([request]) =>
        new URL(request.url).pathname.endsWith("/compact"),
      ),
    ).toBe(false);
    expect(
      mocks.http.mock.calls.filter(([request]) =>
        new URL(request.url).pathname.endsWith("/agent"),
      ),
    ).toHaveLength(1);
    const paths = mocks.http.mock.calls.map(
      ([request]) => new URL(request.url).pathname,
    );
    expect(paths.filter((path) => path.endsWith("/interrupt"))).toHaveLength(2);
    expect(paths.indexOf("/api/session/provider-1")).toBeGreaterThan(
      paths.lastIndexOf("/api/session/provider-1/interrupt"),
    );
  },
);

it("does not forget a failed exact child cleanup barrier when the same resume binding repeats", async () => {
  await sendOpenCodeTurn(input());
  const nativeA = mocks.spawn.mock.calls[0][0];
  mocks.kill.mockRejectedValueOnce(new Error("child cleanup uncertain"));
  await expect(stopOpenCodeSession("same-thread")).rejects.toThrow(
    "child cleanup uncertain",
  );
  bindOpenCodeSession("same-thread", "provider-1", "/repo");
  const eventsB: HarnessEvent[] = [];
  await sendOpenCodeTurn(input(eventsB));
  expect(mocks.kill.mock.calls.map((call) => call[0])).toEqual([
    nativeA,
    nativeA,
  ]);
  expect(eventsB).toContainEqual({
    type: "session.providerBound",
    providerSessionId: "provider-1",
  });
  expect(mocks.kill).not.toHaveBeenCalledWith(mocks.spawn.mock.calls[1][0]);
});

it("refuses provider-session reuse when the post-drain interrupt is uncertain", async () => {
  mocks.version = "opencode v2.0.19";
  await sendOpenCodeTurn(input());
  await stopOpenCodeSession("same-thread");
  mocks.abort.mockRejectedValueOnce(
    new Error("interrupt acknowledgement unknown"),
  );
  await expect(sendOpenCodeTurn(input())).rejects.toThrow(
    "interrupt acknowledgement unknown",
  );
  expect(
    mocks.http.mock.calls.filter(([request]) => request.method === "GET"),
  ).toHaveLength(0);
  expect(mocks.streams.size).toBe(1);
});

it("allows a known missing provider session after the strict post-drain interrupt", async () => {
  mocks.version = "opencode v2.0.19";
  await sendOpenCodeTurn(input());
  await stopOpenCodeSession("same-thread");
  mocks.abort.mockResolvedValueOnce({ status: 404, body: "{}" });
  const original = httpImplementation();
  mocks.http.mockImplementation((request: { url: string; method: string }) => {
    if (
      request.method === "GET" &&
      new URL(request.url).pathname.endsWith("/provider-1")
    )
      return Promise.resolve({ status: 404, body: "{}" });
    return original(request);
  });
  const eventsB: HarnessEvent[] = [];
  await sendOpenCodeTurn(input(eventsB));
  expect(eventsB).toContainEqual({
    type: "session.providerBound",
    providerSessionId: "provider-2",
  });
});

it("drains and invalidates a cancelled steer configuration before the next live-owner turn", async () => {
  mocks.version = "opencode v2.0.19";
  const a = sendOpenCodeTurn({ ...input(), text: "active" });
  await drain();
  const configured = deferred<{ status: number; body: string }>();
  const original = httpImplementation();
  mocks.http.mockImplementation(
    (request: { url: string; method: string; body?: string }) => {
      if (
        new URL(request.url).pathname.endsWith("/agent") &&
        JSON.parse(request.body ?? "{}").agent === "review"
      )
        return configured.promise;
      return original(request);
    },
  );
  const steer = steerOpenCodeTurn({
    sessionId: "same-thread",
    cwd: "/repo",
    model: "opencode:openai/gpt-5",
    modelSettings: { agent: "review" },
    text: "old steer",
  }).catch((error) => error);
  await drain();
  await cancelOpenCodeTurn("same-thread");
  await a;
  const next = sendOpenCodeTurn({ ...input(), text: "new turn" });
  await drain();
  expect(
    mocks.http.mock.calls.filter(([request]) =>
      new URL(request.url).pathname.endsWith("/prompt"),
    ),
  ).toHaveLength(1);
  configured.resolve({ status: 204, body: "" });
  expect(await steer).toMatchObject({
    message: "OpenCode request was cancelled.",
  });
  await drain();
  const nativeId = [...mocks.streams.keys()][0];
  mocks.streams.get(nativeId)?.data(
    JSON.stringify({
      id: "evt_next",
      type: "session.execution.succeeded",
      data: { sessionID: "provider-1" },
    }),
  );
  await next;
  const prompts = mocks.http.mock.calls.filter(([request]) =>
    new URL(request.url).pathname.endsWith("/prompt"),
  );
  expect(prompts.map(([request]) => JSON.parse(request.body))).toEqual([
    { text: "active", files: [], delivery: "queue" },
    { text: "new turn", files: [], delivery: "queue" },
  ]);
  const agents = mocks.http.mock.calls.filter(([request]) =>
    new URL(request.url).pathname.endsWith("/agent"),
  );
  expect(agents.map(([request]) => JSON.parse(request.body).agent)).toEqual([
    "build",
    "review",
    "build",
  ]);
});

it("cancels the pending SSE startup turn without poisoning the next turn on that owner", async () => {
  const opened = deferred<void>();
  mocks.openSse.mockImplementationOnce(() => opened.promise);
  const accepted = vi.fn();
  const a = sendOpenCodeTurn({
    ...input(),
    text: "cancel pending",
    onAccepted: accepted,
  });
  await drain();
  await cancelOpenCodeTurn("same-thread");
  opened.resolve();
  await drain();
  const nativeA = [...mocks.streams.keys()][0];
  const idle = () =>
    mocks.streams.get(nativeA)?.data(
      JSON.stringify({
        type: "session.status",
        properties: { sessionID: "provider-1", status: { type: "idle" } },
      }),
    );
  idle();
  await a;
  expect(accepted).not.toHaveBeenCalled();
  expect(
    mocks.http.mock.calls.some(([request]) =>
      new URL(request.url).pathname.endsWith("/prompt_async"),
    ),
  ).toBe(false);
  const next = sendOpenCodeTurn({
    ...input(),
    text: "next",
    onAccepted: accepted,
  });
  await drain();
  idle();
  await next;
  expect(accepted).toHaveBeenCalledOnce();
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it.each(["v1", "v2"])(
  "admits a fresh %s rewind after cancellation settles",
  async (generation) => {
    if (generation === "v2") mocks.version = "opencode v2.0.19";
    const original = httpImplementation();
    mocks.http.mockImplementation((request: { url: string; method: string }) =>
      new URL(request.url).pathname.endsWith("/message")
        ? Promise.resolve({
            status: 200,
            body: JSON.stringify([
              { info: { id: "user-1", role: "user", time: { created: 1 } } },
            ]),
          })
        : original(request),
    );
    const a = sendOpenCodeTurn({ ...input(), text: "active" });
    await drain();
    await cancelOpenCodeTurn("same-thread");
    await a;
    await expect(rewindOpenCodeLastTurn(input())).resolves.toEqual({
      submitted: false,
    });
    const paths = mocks.http.mock.calls.map(
      ([request]) => new URL(request.url).pathname,
    );
    if (generation === "v2") {
      expect(paths).toContain("/api/session/provider-1/revert/stage");
      expect(paths).toContain("/api/session/provider-1/revert/commit");
    } else expect(paths).toContain("/session/provider-1/revert");
  },
);

it("does not retag a held rewind GET with the next live-owner turn after cancellation", async () => {
  mocks.version = "opencode v2.0.19";
  await sendOpenCodeTurn(input());
  const messages = deferred<{ status: number; body: string }>();
  const original = httpImplementation();
  mocks.http.mockImplementation((request: { url: string; method: string }) =>
    new URL(request.url).pathname.endsWith("/message")
      ? messages.promise
      : original(request),
  );
  const rewind = rewindOpenCodeLastTurn(input()).catch((error) => error);
  await drain();
  await cancelOpenCodeTurn("same-thread");
  const replacement = sendOpenCodeTurn({ ...input(), text: "replacement" });
  await drain();
  messages.resolve({
    status: 200,
    body: JSON.stringify([{ info: { id: "user-1", role: "user" } }]),
  });
  expect(await rewind).toMatchObject({
    message: "OpenCode request was cancelled.",
  });
  await drain();
  const nativeId = [...mocks.streams.keys()][0];
  mocks.streams.get(nativeId)?.data(
    JSON.stringify({
      id: "evt_replacement",
      type: "session.execution.succeeded",
      data: { sessionID: "provider-1" },
    }),
  );
  await replacement;
  expect(
    mocks.http.mock.calls.some(([request]) =>
      new URL(request.url).pathname.includes("/revert/"),
    ),
  ).toBe(false);
  expect(
    mocks.http.mock.calls.filter(([request]) =>
      new URL(request.url).pathname.endsWith("/prompt"),
    ),
  ).toHaveLength(1);
});

it("does not commit an admitted rewind when its fresh operation is cancelled during the stage", async () => {
  mocks.version = "opencode v2.0.19";
  await sendOpenCodeTurn(input());
  const staged = deferred<{ status: number; body: string }>();
  const original = httpImplementation();
  mocks.http.mockImplementation((request: { url: string; method: string }) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/message"))
      return Promise.resolve({
        status: 200,
        body: JSON.stringify([{ info: { id: "user-1", role: "user" } }]),
      });
    if (path.endsWith("/revert/stage")) return staged.promise;
    return original(request);
  });
  const rewind = rewindOpenCodeLastTurn(input()).catch((error) => error);
  await drain();
  expect(
    mocks.http.mock.calls.some(([request]) =>
      new URL(request.url).pathname.endsWith("/revert/stage"),
    ),
  ).toBe(true);
  await cancelOpenCodeTurn("same-thread");
  staged.resolve({ status: 204, body: "" });
  expect(await rewind).toMatchObject({
    message: "OpenCode request was cancelled.",
  });
  expect(
    mocks.http.mock.calls.some(([request]) =>
      new URL(request.url).pathname.endsWith("/revert/commit"),
    ),
  ).toBe(false);
});

it("retires v1 ownership before its exit sink synchronously starts replacement B", async () => {
  let replacement: Promise<void> | undefined;
  await sendOpenCodeTurn({
    ...input(),
    onEvent: (event) => {
      if (event.type === "session.ended")
        replacement = sendOpenCodeTurn(input());
    },
  });
  const nativeA = mocks.spawn.mock.calls[0][0];
  mocks.children.get(nativeA)?.exit(4);
  await replacement;
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  await sendOpenCodeTurn(input());
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
});
