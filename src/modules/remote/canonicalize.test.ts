import { beforeEach, expect, it, vi } from "vitest";
import {
  remoteCanonicalize,
  type RemoteWorkspaceEnv,
} from "@/modules/remote/filesystem";

const io = vi.hoisted(() => ({
  request: vi.fn(),
  handle: vi.fn(),
  canonical: vi.fn(),
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemoteResult: io.request,
}));
vi.mock("@/modules/ssh-native/handles", () => ({ nativeHandleFor: io.handle }));
vi.mock("@/modules/ssh-native/client", async (original) => ({
  ...(await original<typeof import("@/modules/ssh-native/client")>()),
  sftpCanonicalize: io.canonical,
}));
const env: RemoteWorkspaceEnv = {
  kind: "ssh",
  root: "/srv/project",
  sessionId: 7,
  connection: { id: "fixture", name: "Fixture", host: "host-a" },
};
beforeEach(() => {
  vi.resetAllMocks();
  io.handle.mockResolvedValue(undefined);
});

it("requests the actual helper target through the captured session", async () => {
  io.request.mockResolvedValue({ path: "/srv/project/.env.local" });
  expect(await remoteCanonicalize(env, "/srv/project/innocent.txt")).toBe(
    "/srv/project/.env.local",
  );
  expect(io.request).toHaveBeenCalledExactlyOnceWith(7, "fs.canonicalize", {
    path: "innocent.txt",
  });
});

it("fails closed for old helpers without stat or local fallback", async () => {
  io.request.mockRejectedValue(new Error("method_not_found"));
  await expect(remoteCanonicalize(env, "/srv/project/alias")).rejects.toThrow(
    "method_not_found",
  );
  expect(io.request).toHaveBeenCalledTimes(1);
  expect(io.canonical).not.toHaveBeenCalled();
});

it.each([
  "/srv/project/actual",
  "C:\\project\\actual",
  "\\\\server\\share\\actual",
  "//server/share/actual",
])(
  "uses SFTP realpath and preserves the canonical spelling %s",
  async (path) => {
    io.handle.mockResolvedValue("owned-handle");
    io.canonical.mockResolvedValue(path);
    expect(
      await remoteCanonicalize(env, "remote://fixture/srv/project/alias"),
    ).toBe(path);
    expect(io.canonical).toHaveBeenCalledExactlyOnceWith(
      "owned-handle",
      "/srv/project/alias",
    );
    expect(io.request).not.toHaveBeenCalled();
  },
);

it.each([
  undefined,
  null,
  7,
  "",
  "relative",
  "remote://fixture/root",
  "/root/../secret",
  "/root/./secret",
  "/root/line\nname",
  "x".repeat(32769),
  `/${"é".repeat(16384)}`,
])("rejects a malformed canonical result (%#)", async (path) => {
  io.request.mockResolvedValue({ path });
  await expect(remoteCanonicalize(env, "/srv/project/alias")).rejects.toThrow(
    "Invalid remote canonicalization response",
  );
});

it.each(["", "nul\0path", "x".repeat(32769), "é".repeat(16385)])(
  "rejects invalid input before selecting a backend (%#)",
  async (path) => {
    await expect(remoteCanonicalize(env, path)).rejects.toThrow(
      "Invalid remote canonicalization path",
    );
    expect(io.handle).not.toHaveBeenCalled();
    expect(io.request).not.toHaveBeenCalled();
  },
);

it("does not switch to the helper after a native realpath failure", async () => {
  io.handle.mockResolvedValue("owned-handle");
  io.canonical.mockRejectedValue(new Error("outside workspace"));
  await expect(remoteCanonicalize(env, "/srv/project/alias")).rejects.toThrow(
    "outside workspace",
  );
  expect(io.request).not.toHaveBeenCalled();
});
