import { beforeEach, expect, it, vi } from "vitest";
import { createInlineReferenceReader } from "@/modules/editor/lib/inlineEditReferences";
import type { WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  canonical: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  profiles: [{ id: "fixture", name: "Fixture", host: "host-a" }],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ sshConnections: io.profiles }) },
}));
vi.mock("@/modules/connections/model/remoteProjects", async (original) => ({
  ...(await original<
    typeof import("@/modules/connections/model/remoteProjects")
  >()),
  remoteProjectForPath: () => ({
    environmentId: "voktty-ssh-fixture",
    cwd: "/srv/project",
  }),
}));
vi.mock("@/modules/remote", () => ({
  isPathInRemoteWorkspace: (env: WorkspaceEnv) => env.kind === "ssh",
  remoteCanonicalize: io.canonical,
  remoteStat: io.stat,
  remoteReadDocument: io.read,
}));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteStat: io.stat,
  remoteReadDocument: io.read,
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));

const current = () => true;
const local = { kind: "local" } as const;
const unsupported: WorkspaceEnv[] = [
  { kind: "serial", portName: "fixture", baudRate: 9600 },
  {
    kind: "docker",
    connection: {
      containerId: "fixture",
      containerName: "Fixture",
      image: "fixture",
    },
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  io.profiles = [{ id: "fixture", name: "Fixture", host: "host-a" }];
  io.stat.mockResolvedValue({ size: 10, kind: "file" });
  io.read.mockResolvedValue({ kind: "text", content: "remote", size: 6 });
  io.canonical.mockImplementation(async (_: unknown, path: string) => path);
  io.acquire.mockResolvedValue({
    info: { session_id: 7, workspace_root: "/srv/project" },
    release: io.release,
  });
  io.invoke.mockImplementation(
    async (command: string, args: { path: string }) => {
      if (command === "fs_canonicalize") return args.path;
      if (command === "fs_stat") return { size: 10, kind: "file" };
      return { kind: "text", size: 10, content: "native" };
    },
  );
});

it.each([
  ["/work/src/main.ts", "../helper.ts", "/work/helper.ts", local],
  ["C:/work/main.ts", "helper.ts", "C:/work/helper.ts", local],
  [
    "//server/share/main.ts",
    "../../helper.ts",
    "//server/share/helper.ts",
    local,
  ],
  [
    "/work/main.ts",
    "helper.ts",
    "/work/helper.ts",
    { kind: "wsl", distro: "Ubuntu" },
  ],
] as const)(
  "resolves %s references through the captured filesystem",
  async (document, mention, resolved, workspace) => {
    expect(
      await createInlineReferenceReader(document, workspace)(mention, current),
    ).toBe("native");
    expect(io.invoke).toHaveBeenLastCalledWith(
      "fs_read_file",
      expect.objectContaining({ path: resolved, workspace }),
    );
  },
);

it("retains the explicit SSH host and session", async () => {
  const workspace = {
    kind: "ssh",
    root: "/srv/project",
    sessionId: 8,
    connection: { id: "fixture", name: "Fixture", host: "host-a" },
  } as const;
  const reader = createInlineReferenceReader("/srv/project/main.ts", workspace);
  expect(await reader("helper.ts", current)).toBe("remote");
  expect(io.read).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 8 }),
    "/srv/project/helper.ts",
    false,
  );
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each(unsupported)(
  "does not read a POSIX reference on this computer for %j",
  async (workspace) => {
    expect(
      await createInlineReferenceReader("/work/main.ts", workspace)(
        "helper.ts",
        current,
      ),
    ).toBeUndefined();
    expect(io.invoke).not.toHaveBeenCalled();
  },
);

it.each(unsupported)(
  "preserves native Windows document interpretation for %j",
  async (workspace) => {
    expect(
      await createInlineReferenceReader("C:/work/main.ts", workspace)(
        "helper.ts",
        current,
      ),
    ).toBe("native");
    expect(io.invoke).toHaveBeenLastCalledWith(
      "fs_read_file",
      expect.objectContaining({ workspace: local }),
    );
  },
);

it("reads a namespace only through its captured saved project and own helper leases", async () => {
  const reader = createInlineReferenceReader(
    "remote://voktty-ssh-fixture/srv/project/main.ts",
    local,
  );
  io.profiles[0].host = "host-b";
  expect(await reader("helper.ts", current)).toBe("remote");
  expect(io.acquire).toHaveBeenCalledWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "host-a" }),
  );
  expect(io.read).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 7 }),
    "/srv/project/helper.ts",
    false,
  );
  expect(io.release).toHaveBeenCalledTimes(2);
  expect(io.invoke).not.toHaveBeenCalled();
});

it("does not fall back to local IO when namespace acquisition fails", async () => {
  io.acquire.mockRejectedValue(new Error("offline"));
  const reader = createInlineReferenceReader(
    "remote://voktty-ssh-fixture/srv/project/main.ts",
    local,
  );
  await expect(reader("helper.ts", current)).rejects.toThrow("offline");
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([".env.local", ".ssh/config.json", "secrets.json"])(
  "blocks a sensitive literal reference %s before IO",
  async (mention) => {
    expect(
      await createInlineReferenceReader("/work/main.ts", local)(
        mention,
        current,
      ),
    ).toBeUndefined();
    expect(io.invoke).not.toHaveBeenCalled();
  },
);

it("checks canonical native paths before stat or read", async () => {
  io.invoke.mockResolvedValue("/work/.ssh/config");
  expect(
    await createInlineReferenceReader("/work/main.ts", local)(
      "innocent.txt",
      current,
    ),
  ).toBeUndefined();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});

it("does not read an oversized reference", async () => {
  io.invoke.mockImplementation(
    async (command: string, args: { path: string }) =>
      command === "fs_canonicalize"
        ? args.path
        : { size: 1024 * 1024 + 1, kind: "file" },
  );
  expect(
    await createInlineReferenceReader("/work/main.ts", local)(
      "large.txt",
      current,
    ),
  ).toBeUndefined();
  expect(io.invoke.mock.calls.map(([command]) => command)).toEqual([
    "fs_canonicalize",
    "fs_stat",
  ]);
});

it("retires after canonicalization without issuing a later read", async () => {
  let active = true;
  io.invoke.mockImplementation(async (_: string, args: { path: string }) => {
    active = false;
    return args.path;
  });
  expect(
    await createInlineReferenceReader("/work/main.ts", local)(
      "helper.ts",
      () => active,
    ),
  ).toBeUndefined();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});
