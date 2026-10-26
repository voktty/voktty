import { beforeEach, expect, it, vi } from "vitest";
import type { RemoteWorkspaceEnv } from "@/modules/remote";
import {
  remoteSearchGlob,
  remoteSearchGrep,
} from "@/modules/ai/lib/remoteSearch";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: request,
}));
const env: RemoteWorkspaceEnv = {
  kind: "ssh",
  connection: { id: "original", name: "Original", host: "fixture.invalid" },
  root: "/fixture",
  sessionId: 7,
};
beforeEach(() => vi.resetAllMocks());

it("uses an independent regex query under the captured helper root", async () => {
  request.mockResolvedValue({ hits: [], truncated: false, files_scanned: 0 });
  expect(
    await remoteSearchGrep(env, {
      root: "/fixture/src",
      pattern: "needle.*",
      glob: ["**/*.ts"],
      maxResults: 30,
    }),
  ).toEqual({ hits: [], truncated: false, files_scanned: 0 });
  expect(request).toHaveBeenCalledExactlyOnceWith(7, "fs.grepIndependent", {
    cwd: "src",
    pattern: "needle.*",
    include: ["**/*.ts"],
    regex: true,
    caseSensitive: true,
    showHidden: false,
    maxResults: 30,
  });
});

it("preserves literal POSIX backslashes and space directories", async () => {
  const hit = { path: "/fixture/ /a\\b", rel: "a\\b" };
  request.mockResolvedValue({ hits: [hit], truncated: false });
  expect(
    await remoteSearchGlob(env, { root: "/fixture/ ", pattern: "*" }),
  ).toEqual({ hits: [hit], truncated: false });
  expect(request).toHaveBeenCalledWith(7, "fs.glob", {
    cwd: " ",
    pattern: "*",
    maxResults: 500,
  });
});

it.each(["/other", "/fixture/../outside", "remote://fixture/src", "/fixture2"])(
  "rejects an unresolved or escaped search root %s before transport",
  async (root) => {
    await expect(
      remoteSearchGlob(env, { root, pattern: "*" }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  },
);

it("rejects a disconnected source before transport", async () => {
  await expect(
    remoteSearchGlob(
      { ...env, sessionId: undefined },
      {
        root: "/fixture",
        pattern: "*",
      },
    ),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it.each([
  null,
  { hits: [], truncated: "false" },
  { hits: [{ path: "/outside/file", rel: "file" }], truncated: false },
  { hits: [{ path: "/fixture/../file", rel: "../file" }], truncated: false },
  { hits: [{ path: "/fixture/a", rel: "b" }], truncated: false },
])("rejects malformed or out-of-root glob output: %j", async (value) => {
  request.mockResolvedValue(value);
  await expect(
    remoteSearchGlob(env, { root: "/fixture", pattern: "*" }),
  ).rejects.toThrow("response");
});

it("rejects output beyond the requested result cap", async () => {
  request.mockResolvedValue({
    hits: [
      { path: "/fixture/a", rel: "a" },
      { path: "/fixture/b", rel: "b" },
    ],
    truncated: false,
  });
  await expect(
    remoteSearchGlob(env, { root: "/fixture", pattern: "*", maxResults: 1 }),
  ).rejects.toThrow("response");
});

it("rejects malformed grep locations and missing scan metadata", async () => {
  for (const value of [
    { hits: [], truncated: false },
    {
      hits: [{ path: "/fixture/a", rel: "a", line: 0, text: "needle" }],
      truncated: false,
      files_scanned: 1,
    },
  ]) {
    request.mockResolvedValue(value);
    await expect(
      remoteSearchGrep(env, { root: "/fixture", pattern: "needle" }),
    ).rejects.toThrow("response");
  }
});

it("does not retry a rejected helper method through interactive search", async () => {
  const failure = new Error("method_not_found");
  request.mockRejectedValue(failure);
  await expect(
    remoteSearchGrep(env, { root: "/fixture", pattern: "needle" }),
  ).rejects.toBe(failure);
  expect(request).toHaveBeenCalledTimes(1);
});

it("bounds request and response bytes", async () => {
  await expect(
    remoteSearchGlob(env, {
      root: "/fixture",
      pattern: "x".repeat(256 * 1024),
    }),
  ).rejects.toThrow("request limit");
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue({
    hits: [
      {
        path: "/fixture/a",
        rel: "a",
        line: 1,
        text: "x".repeat(4 * 1024 * 1024),
      },
    ],
    truncated: false,
    files_scanned: 1,
  });
  await expect(
    remoteSearchGrep(env, { root: "/fixture", pattern: "x" }),
  ).rejects.toThrow("response");
});

it("keeps filesystem-root queries and case-insensitive regex semantics", async () => {
  request.mockResolvedValue({
    hits: [{ path: "/a", rel: "a", line: 1, text: "Needle" }],
    truncated: true,
    files_scanned: 1,
  });
  expect(
    await remoteSearchGrep(
      { ...env, root: "/" },
      {
        root: "/",
        pattern: "needle",
        caseInsensitive: true,
        maxResults: 1,
      },
    ),
  ).toMatchObject({
    hits: [{ path: "/a", rel: "a", line: 1, text: "Needle" }],
    truncated: true,
  });
  expect(request).toHaveBeenCalledWith(
    7,
    "fs.grepIndependent",
    expect.objectContaining({ cwd: ".", caseSensitive: false, regex: true }),
  );
});
