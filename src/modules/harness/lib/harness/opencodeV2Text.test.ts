import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  http: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("./child", () => ({
  execChild: async (_path: string, args: string[]) => {
    if (args[0] !== "service") return "opencode 2.0.15";
    return args[1] === "get" ? "test-password" : "http://127.0.0.1:4096";
  },
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  harnessHttp: mocks.http,
  closeHarnessSse: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: vi.fn(),
  spawnChild: mocks.spawn,
}));

import { runOpenCodeTextPrompt, stopOpenCodeTextPrompt } from "./opencodeText";

describe("OpenCode v2 text sessions", () => {
  beforeEach(() => {
    mocks.http.mockReset();
    mocks.spawn.mockClear();
    mocks.http.mockImplementation(
      async (request: { url: string; method: string }) => {
        const path = new URL(request.url).pathname;
        if (request.method === "POST" && path === "/api/session") {
          return {
            status: 200,
            body: JSON.stringify({ data: { id: "text_session" } }),
          };
        }
        if (path.endsWith("/generate")) {
          return {
            status: 200,
            body: JSON.stringify({ data: { text: "Generated title" } }),
          };
        }
        return { status: 204, body: "" };
      },
    );
  });

  afterEach(stopOpenCodeTextPrompt);

  it("generates authenticated text and deletes only its temporary session", async () => {
    await expect(
      runOpenCodeTextPrompt({
        cwd: "/repo",
        prompt: "Title",
        model: "openai/test",
      }),
    ).resolves.toBe("Generated title");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.http).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:4096/api/session?directory=%2Frepo",
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("opencode:test-password")}`,
        }),
        body: JSON.stringify({
          location: { directory: "/repo" },
          permissions: [{ action: "*", resource: "*", effect: "deny" }],
        }),
      }),
    );
    expect(mocks.http).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "http://127.0.0.1:4096/api/session/text_session?directory=%2Frepo",
      }),
    );
  });

  it.each(["empty", "failure"])(
    "deletes its temporary session after %s generation",
    async (outcome) => {
      mocks.http.mockImplementation(
        async (request: { url: string; method: string }) => {
          const path = new URL(request.url).pathname;
          if (request.method === "POST" && path === "/api/session") {
            return {
              status: 200,
              body: JSON.stringify({ data: { id: "text_session" } }),
            };
          }
          if (path.endsWith("/generate") && outcome === "failure") {
            return {
              status: 500,
              body: JSON.stringify({ message: "Generation failed" }),
            };
          }
          return { status: 204, body: "" };
        },
      );
      await expect(
        runOpenCodeTextPrompt({
          cwd: "/repo",
          prompt: "Title",
          model: "openai/test",
        }),
      ).rejects.toThrow(
        outcome === "failure" ? "Generation failed" : "empty output",
      );
      expect(mocks.http).toHaveBeenCalledWith(
        expect.objectContaining({ method: "DELETE" }),
      );
    },
  );

  it("interrupts and deletes its temporary session when cancelled", async () => {
    let finishGenerate:
      | ((response: { status: number; body: string }) => void)
      | undefined;
    mocks.http.mockImplementation(
      async (request: { url: string; method: string }) => {
        const path = new URL(request.url).pathname;
        if (request.method === "POST" && path === "/api/session") {
          return {
            status: 200,
            body: JSON.stringify({ data: { id: "text_session" } }),
          };
        }
        if (path.endsWith("/generate")) {
          return new Promise((resolve) => {
            finishGenerate = resolve;
          });
        }
        return { status: 204, body: "" };
      },
    );
    const controller = new AbortController();
    const prompt = runOpenCodeTextPrompt({
      cwd: "/repo",
      prompt: "Generate text",
      model: "openai/test",
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(finishGenerate).toBeTypeOf("function"));
    controller.abort();

    await expect(prompt).rejects.toThrow("By-the-way request cancelled");
    expect(mocks.http).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://127.0.0.1:4096/api/session/text_session/interrupt?directory=%2Frepo&resume=false",
      }),
    );
    expect(mocks.http).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "http://127.0.0.1:4096/api/session/text_session?directory=%2Frepo",
      }),
    );
    finishGenerate?.({
      status: 200,
      body: JSON.stringify({ data: { text: "late" } }),
    });
  });
});
