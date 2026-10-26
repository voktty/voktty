import { beforeEach, expect, it, vi } from "vitest";
import { acquireDocExtension } from "@/modules/lsp/lib/sessionManager";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({ detect: vi.fn(), invoke: vi.fn() }));
vi.mock("@/modules/lsp/lib/detect", () => ({ detectBinary: io.detect }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/work",
  sessionId: 7,
  connection: { id: "host", name: "Host", host: "example.test" },
};
beforeEach(() => {
  vi.resetAllMocks();
  io.detect.mockResolvedValue(false);
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  usePreferencesStore.setState({
    lspActivation: { typescript: "enabled" },
    lspCustomServers: [],
  });
});

it("does not probe local binaries for a document owned by SSH", async () => {
  expect(await acquireDocExtension("/work/file.ts", "ts", ssh)).toBeNull();
  expect(io.detect).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("probes a local document independently of the globally selected SSH environment", async () => {
  useWorkspaceEnvStore.setState({ env: ssh });
  await acquireDocExtension("/work/file.ts", "ts", { kind: "local" });
  expect(io.detect).toHaveBeenCalledOnce();
});

it.each([
  ["remote://voktty-ssh-host/work/file.ts", { kind: "local" }],
  ["/work/file.ts", { kind: "wsl", distro: "fixture" }],
  ["/work/file.ts", { kind: "serial", portName: "fixture", baudRate: 9600 }],
  [
    "/work/file.ts",
    {
      kind: "docker",
      connection: { containerId: "a", containerName: "A", image: "fixture" },
    },
  ],
] satisfies [string, WorkspaceEnv][])(
  "refuses unsupported document %s before probing",
  async (path, workspace) => {
    await acquireDocExtension(path, "ts", workspace);
    expect(io.detect).not.toHaveBeenCalled();
    expect(io.invoke).not.toHaveBeenCalled();
  },
);

it.each(["C:\\work\\file.ts", "\\\\server\\share\\file.ts"])(
  "preserves native Windows ownership of %s",
  async (path) => {
    await acquireDocExtension(path, "ts", ssh);
    expect(io.detect).toHaveBeenCalledOnce();
  },
);

it("does not resolve a root after retirement during detection", async () => {
  let current = true;
  io.detect.mockImplementation(async () => {
    current = false;
    return "/bin/server";
  });
  await acquireDocExtension(
    "/work/file.ts",
    "ts",
    { kind: "local" },
    undefined,
    undefined,
    () => current,
  );
  expect(io.invoke).not.toHaveBeenCalled();
});

it("does not acquire a native server after retirement during root resolution", async () => {
  let current = true;
  io.detect.mockResolvedValue("/bin/server");
  io.invoke.mockImplementation(async () => {
    current = false;
    return "/work";
  });
  await acquireDocExtension(
    "/work/file.ts",
    "ts",
    { kind: "local" },
    undefined,
    undefined,
    () => current,
  );
  expect(io.invoke).toHaveBeenCalledOnce();
  expect(io.invoke).toHaveBeenCalledWith(
    "lsp_resolve_root",
    expect.objectContaining({ path: "/work/file.ts" }),
  );
});

it("keeps retired acquisitions counted until their original stage settles", async () => {
  let finish!: (value: string) => void;
  io.detect.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let current = true;
  const work = Array.from({ length: 256 }, () =>
    acquireDocExtension(
      "/work/file.ts",
      "ts",
      { kind: "local" },
      undefined,
      undefined,
      () => current,
    ),
  );
  current = false;
  await acquireDocExtension("/work/file.ts", "ts", { kind: "local" });
  expect(io.detect).toHaveBeenCalledTimes(256);
  finish("/bin/server");
  expect(await Promise.all(work)).toEqual(Array(256).fill(null));
  expect(io.invoke).not.toHaveBeenCalled();
  io.detect.mockResolvedValue(false);
  await acquireDocExtension("/work/file.ts", "ts", { kind: "local" });
  expect(io.detect).toHaveBeenCalledTimes(257);
});
