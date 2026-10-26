// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectEntryMetadata } from "@/modules/explorer/lib/useProjectEntryMetadata";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceEnv } from "@/modules/workspace";
import { ExplorerEntryPreview } from "@/modules/explorer/ExplorerEntryPreview";

vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onOpenChange(true)}>
        hover
      </button>
      {children}
    </div>
  ),
  HoverCardTrigger: ({ children }: { children: ReactNode }) => children,
  HoverCardContent: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/modules/remote", () => ({
  isPathInRemoteWorkspace: () => false,
  remoteReadBinaryFile: vi.fn(),
}));

const io = vi.hoisted(() => ({
  stat: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/filesystem", () => ({ remoteStat: io.stat }));
vi.mock("@/modules/connections/model/remoteProjects", async (original) => ({
  ...(await original<
    typeof import("@/modules/connections/model/remoteProjects")
  >()),
  remoteProjectForPath: () => ({
    environmentId: "voktty-ssh-fixture",
    cwd: "/srv/project",
  }),
}));

const path = "remote://voktty-ssh-fixture/srv/project/file.txt";
const local = { kind: "local" } as const;
let root: Root;
let node: HTMLDivElement;
let metadata: ReturnType<typeof useProjectEntryMetadata>;
function Reader({
  target = path,
  open = true,
  workspace = local,
}: {
  target?: string;
  open?: boolean;
  workspace?: WorkspaceEnv;
}) {
  metadata = useProjectEntryMetadata(target, workspace, open);
  return <span>{metadata?.size ?? "unknown"}</span>;
}
async function render(props: Parameters<typeof Reader>[0] = {}) {
  await act(async () => root.render(<Reader {...props} />));
  await act(async () => vi.dynamicImportSettled());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  io.stat.mockResolvedValue({ size: 23, mtime: 100 });
  io.acquire.mockResolvedValue({
    info: { session_id: 7, workspace_root: "/srv/project" },
    release: io.release,
  });
  usePreferencesStore.setState({
    sshConnections: [{ id: "fixture", name: "Fixture", host: "host-a" }],
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("reads actual namespace metadata only while its tooltip is open", async () => {
  await render({ open: false });
  expect(io.stat).not.toHaveBeenCalled();
  await render();
  expect(metadata).toEqual({ size: 23, mtime: 100 });
  expect(io.acquire).toHaveBeenCalledWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "host-a" }),
  );
  expect(io.stat).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 7 }),
    "/srv/project/file.txt",
  );
  expect(io.release).toHaveBeenCalledTimes(1);
  await render({ open: false });
  expect(metadata).toBeUndefined();
  await render();
  expect(io.stat).toHaveBeenCalledTimes(2);
});

it.each(["/work/a.txt", "C:/work/a.txt", "//server/share/a.txt"])(
  "keeps native listing metadata without another read: %s",
  async (target) => {
    await render({ target });
    expect(io.stat).not.toHaveBeenCalled();
  },
);

it("cannot publish a closed request into a reopened tooltip", async () => {
  let finish!: (value: { size: number; mtime: number }) => void;
  io.stat.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await render({ open: false });
  await render();
  await act(async () => finish({ size: 999, mtime: 999 }));
  expect(metadata?.size).toBe(23);
});

it("retires a same-path request when its filesystem is replaced", async () => {
  let finish!: (value: { size: number; mtime: number }) => void;
  io.stat.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await render({ workspace: { kind: "wsl", distro: "Other" } });
  await act(async () => finish({ size: 999, mtime: 999 }));
  expect(metadata?.size).toBe(23);
});

it("leaves failed metadata unknown instead of fabricating zero", async () => {
  io.stat.mockRejectedValue(new Error("offline"));
  await render();
  expect(metadata).toBeUndefined();
  expect(node.textContent).toBe("unknown");
});

it.each([
  { size: -1, mtime: 1 },
  { size: NaN, mtime: 1 },
  { size: 1, mtime: Infinity },
])("rejects invalid metadata %j", async (value) => {
  io.stat.mockResolvedValue(value);
  await render();
  expect(metadata).toBeUndefined();
});

it("preserves a genuinely empty remote file", async () => {
  io.stat.mockResolvedValue({ size: 0, mtime: 100 });
  await render();
  expect(metadata?.size).toBe(0);
});

it("keeps only the current StrictMode request", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Reader />
      </StrictMode>,
    ),
  );
  await act(async () => vi.dynamicImportSettled());
  expect(metadata?.size).toBe(23);
  await act(async () => root.unmount());
  expect(io.release).toHaveBeenCalledTimes(1);
});

it("displays actual metadata instead of the namespace listing's synthetic zero", async () => {
  await act(async () =>
    root.render(
      <ExplorerEntryPreview
        path={path}
        name="file.txt"
        isDir={false}
        size={0}
        mtime={0}
        workspace={local}
      >
        <span>file</span>
      </ExplorerEntryPreview>,
    ),
  );
  expect(node.textContent).not.toContain("0 B");
  expect(io.stat).not.toHaveBeenCalled();
  await act(async () => node.querySelector("button")?.click());
  await act(async () => vi.dynamicImportSettled());
  expect(node.textContent).toContain("23 B");
});

it("retains retired reads in the shared 256-request budget until settlement", async () => {
  const finishes: Array<(value: { size: number; mtime: number }) => void> = [];
  io.stat.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  const paths = Array.from({ length: 256 }, (_, index) => `${path}${index}`);
  await act(async () =>
    root.render(paths.map((target) => <Reader key={target} target={target} />)),
  );
  await act(async () => vi.dynamicImportSettled());
  expect(io.stat).toHaveBeenCalledTimes(256);
  await render({ target: `${path}-successor` });
  expect(io.stat).toHaveBeenCalledTimes(256);
  await act(async () => {
    for (const finish of finishes) finish({ size: 1, mtime: 1 });
  });
  expect(metadata).toBeUndefined();
  io.stat.mockResolvedValue({ size: 23, mtime: 100 });
  await render({ open: false });
  await render();
  expect(io.stat).toHaveBeenCalledTimes(257);
  expect(metadata?.size).toBe(23);
});
