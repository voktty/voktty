import { beforeEach, expect, it, vi } from "vitest";
import {
  canSearchFilenames,
  searchFilenames,
  FilenameSearchUnavailableError,
} from "@/modules/explorer/lib/filenameSearch";
import { RemoteRequestError } from "@/modules/remote/client";
import type { WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
const env: WorkspaceEnv = {
  kind: "ssh",
  root: "/repo",
  sessionId: 7,
  connection: { id: "original", name: "Original", host: "fixture.invalid" },
};
beforeEach(() => vi.resetAllMocks());

it("captures its session before lazy loading and reconstructs only relative results", async () => {
  const source = { ...env };
  io.request.mockResolvedValue({
    hits: [
      { rel: "literal\\file.ts", name: "literal\\file.ts", is_dir: false },
    ],
    truncated: true,
  });
  const pending = searchFilenames(source, "/repo/ ", "file", true, () => true);
  source.sessionId = 99;
  const result = await pending;
  expect(io.request).toHaveBeenCalledExactlyOnceWith(7, "fs.searchNames", {
    cwd: " ",
    query: "file",
    showHidden: true,
    maxResults: 200,
  });
  expect(result.hits[0].path).toBe("/repo/ /literal\\file.ts");
  expect(result.truncated).toBe(true);
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([
  "/repo2",
  "/outside",
  "/repo/../outside",
  "remote://fixture/file",
  "/repo/./src",
])("refuses unqualified root %s", async (root) => {
  expect(canSearchFilenames(env, root)).toBe(false);
  await expect(
    searchFilenames(env, root, "file", false, () => true),
  ).rejects.toBeInstanceOf(FilenameSearchUnavailableError);
  expect(io.request).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("refuses disconnected sources", () => {
  expect(canSearchFilenames({ ...env, sessionId: undefined }, "/repo")).toBe(
    false,
  );
});

it("bounds both the authenticated root and relative search directory before transport", async () => {
  const path = `/repo/${"x".repeat(32768)}`;
  expect(canSearchFilenames(env, path)).toBe(false);
  expect(canSearchFilenames({ ...env, root: path }, path)).toBe(false);
  await expect(
    searchFilenames(env, path, "file", false, () => true),
  ).rejects.toBeInstanceOf(FilenameSearchUnavailableError);
  expect(io.request).not.toHaveBeenCalled();
});

it("keeps native UNC paths on the native filesystem even with an SSH source", async () => {
  io.invoke.mockResolvedValue({ hits: [], truncated: false });
  await searchFilenames(env, "//server/share", "file", false, () => true);
  expect(io.invoke).toHaveBeenCalledWith(
    "fs_search",
    expect.objectContaining({
      workspace: { kind: "local" },
      root: "//server/share",
    }),
  );
  expect(io.request).not.toHaveBeenCalled();
});

it("retires before transport after lazy loading", async () => {
  let current = true;
  const pending = searchFilenames(env, "/repo", "file", false, () => current);
  current = false;
  await expect(pending).rejects.toThrow("retired");
  expect(io.request).not.toHaveBeenCalled();
});

it("retires after an already admitted response without adopting it", async () => {
  let current = true;
  io.request.mockImplementation(async () => {
    current = false;
    return { hits: [], truncated: false };
  });
  await expect(
    searchFilenames(env, "/repo", "file", false, () => current),
  ).rejects.toThrow("retired");
  expect(io.request).toHaveBeenCalledTimes(1);
});

it("reports unsupported old helpers without retrying locally", async () => {
  io.request.mockRejectedValue(
    new RemoteRequestError("method_not_found", "old helper"),
  );
  await expect(
    searchFilenames(env, "/repo", "file", false, () => true),
  ).rejects.toBeInstanceOf(FilenameSearchUnavailableError);
  expect(io.request).toHaveBeenCalledTimes(1);
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([
  { rel: "../file", name: "file", is_dir: false },
  { rel: "/file", name: "file", is_dir: false },
  { rel: "a//file", name: "file", is_dir: false },
  { rel: "a/./file", name: "file", is_dir: false },
  { rel: "a/file", name: "other", is_dir: false },
  { rel: "file", name: "file", is_dir: "false" },
  { rel: "file", name: "file", is_dir: false, path: "/outside/file" },
  { rel: "file\0", name: "file\0", is_dir: false },
])("rejects untrusted result hit %j", async (hit) => {
  io.request.mockResolvedValue({ hits: [hit], truncated: false });
  await expect(
    searchFilenames(env, "/repo", "file", false, () => true),
  ).rejects.toThrow("search hit");
});

it("bounds result counts, duplicates, bytes and query bytes", async () => {
  const hit = { rel: "file", name: "file", is_dir: false };
  for (const hits of [
    [hit, hit],
    Array.from({ length: 201 }, () => hit),
    [{ ...hit, rel: "f".repeat(4 * 1024 * 1024) }],
  ]) {
    io.request.mockResolvedValue({ hits, truncated: false });
    await expect(
      searchFilenames(env, "/repo", "file", false, () => true),
    ).rejects.toThrow();
  }
  io.request.mockClear();
  await expect(
    searchFilenames(env, "/repo", "é".repeat(2049), false, () => true),
  ).rejects.toThrow("query");
  expect(io.request).not.toHaveBeenCalled();
});
