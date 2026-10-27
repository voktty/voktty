// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { createProjectDocument } from "@/modules/remote/projectDocument";

const io = vi.hoisted(() => ({ acquire: vi.fn(), request: vi.fn() }));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/client", () => ({
  requestRemoteResult: io.request,
}));

const profile = { id: "index", name: "Index", host: "index.invalid" };
const project = {
  key: "index-project",
  projectId: "index-project",
  environmentId: "voktty-ssh-index",
  cwd: "/alias/project",
};
const path = "remote://voktty-ssh-index/alias/project/src";
const release = vi.fn();
const document = () => createProjectDocument(path, project, [profile]);

beforeEach(() => {
  vi.resetAllMocks();
  io.acquire.mockResolvedValue({
    info: { session_id: 31, workspace_root: "/canonical/project" },
    release,
  });
  io.request.mockResolvedValue({
    hits: [
      { rel: "deep/file.ts", path: "/canonical/project/src/deep/file.ts" },
    ],
    truncated: false,
  });
});

it("indexes relative to the saved folder under its own accepted helper root", async () => {
  await expect(document().listFiles(() => true)).resolves.toEqual({
    files: ["deep/file.ts"],
    truncated: false,
  });
  expect(io.acquire).toHaveBeenCalledWith(
    { profileId: "index", root: "/alias/project" },
    expect.objectContaining({ host: "index.invalid" }),
  );
  expect(io.request).toHaveBeenCalledExactlyOnceWith(31, "fs.glob", {
    cwd: "src",
    pattern: "**/*",
    maxResults: 2000,
  });
  expect(release).toHaveBeenCalledOnce();
});

it("retains truncation and deduplicates relative names without trusting host paths", async () => {
  io.request.mockResolvedValue({
    hits: [{ rel: "file.ts", path: "/outside" }, { rel: "file.ts" }],
    truncated: true,
  });
  await expect(document().listFiles(() => true)).resolves.toEqual({
    files: ["file.ts"],
    truncated: true,
  });
});

it.each([
  "../escape",
  "/absolute",
  "a/../b",
  "a//b",
  "a\\b",
  "a\0b",
  "",
  "C:/file",
  "a\nfile",
])(
  "rejects unrepresentable or escaping helper name %j and releases its lease",
  async (rel) => {
    io.request.mockResolvedValue({ hits: [{ rel }], truncated: false });
    await expect(document().listFiles(() => true)).rejects.toThrow(
      "Invalid remote file index",
    );
    expect(release).toHaveBeenCalledOnce();
  },
);

it.each([
  null,
  {},
  { hits: [], truncated: "false" },
  { hits: [null], truncated: false },
  {
    hits: Array.from({ length: 2001 }, () => ({ rel: "file" })),
    truncated: true,
  },
])("rejects malformed or oversized index responses", async (response) => {
  io.request.mockResolvedValue(response);
  await expect(document().listFiles(() => true)).rejects.toThrow(
    "Invalid remote file index",
  );
  expect(release).toHaveBeenCalledOnce();
});

it("keeps the lease until a retired helper read actually settles", async () => {
  let finish!: (value: unknown) => void;
  io.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let current = true;
  const pending = document().listFiles(() => current);
  await vi.waitFor(() => expect(io.request).toHaveBeenCalledOnce());
  current = false;
  expect(release).not.toHaveBeenCalled();
  finish({ hits: [], truncated: false });
  await expect(pending).rejects.toThrow("retired");
  expect(release).toHaveBeenCalledOnce();
});

it("does not issue a scan after retirement during lease acquisition", async () => {
  let accept!: (value: unknown) => void;
  io.acquire.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  let current = true;
  const pending = document().listFiles(() => current);
  current = false;
  accept({
    info: { session_id: 31, workspace_root: "/canonical/project" },
    release,
  });
  await expect(pending).rejects.toThrow("retired");
  expect(io.request).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it.each(["src/../src", "literal\\folder", "line\nfolder"])(
  "rejects ambiguous namespace folder %j before opening a helper",
  async (folder) => {
    const document = createProjectDocument(
      `remote://voktty-ssh-index/alias/project/${folder}`,
      project,
      [profile],
    );
    await expect(document.listFiles(() => true)).rejects.toThrow("index root");
    expect(io.acquire).not.toHaveBeenCalled();
  },
);

it("releases a failed helper request without substituting a local index", async () => {
  io.request.mockRejectedValue(new Error("method_not_found"));
  await expect(document().listFiles(() => true)).rejects.toThrow(
    "method_not_found",
  );
  expect(release).toHaveBeenCalledOnce();
});

it("rejects excessive aggregate path data", async () => {
  io.request.mockResolvedValue({
    hits: Array.from({ length: 256 }, () => ({ rel: "x".repeat(32768) })),
    truncated: false,
  });
  await expect(document().listFiles(() => true)).rejects.toThrow(
    "Invalid remote file index",
  );
  expect(release).toHaveBeenCalledOnce();
});
