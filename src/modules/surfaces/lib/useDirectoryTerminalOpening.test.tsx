// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDirectoryTerminalOpening } from "@/modules/surfaces/lib/useDirectoryTerminalOpening";
import { useProjectTerminalRequests } from "@/app/hooks/useProjectTerminalRequests";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

const remote: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  sessionId: 7,
  connection: { id: "build", name: "Build", host: "build.example" },
};
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: mocks.resolve,
}));
const create = vi.fn();
const openProject =
  vi.fn<
    (path: string, options: { isCurrent: () => boolean }) => Promise<unknown>
  >();
const onError = vi.fn();
let root: Root;
let node: HTMLDivElement;
let open: ReturnType<typeof useDirectoryTerminalOpening>;
type Props = {
  workspace?: WorkspaceEnv;
  selectedKey?: string;
  folder?: string;
};
function Probe({
  workspace = remote,
  selectedKey = "source",
  folder = "/project",
}: Props) {
  open = useDirectoryTerminalOpening({
    spaceId: "main",
    selectedKey,
    root: folder,
    workspace,
    create,
    openProject,
    onError,
  });
  return null;
}
async function render(props: Props = {}) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe {...props} />
      </StrictMode>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  create.mockReset();
  onError.mockReset();
  openProject.mockReset().mockResolvedValue(undefined);
  mocks.resolve.mockReset();
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  useSpaces.setState({
    activeId: "main",
    spaces: [
      {
        id: "main",
        name: "Main",
        root: "/project",
        env: remote,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await ownedPtyTargets.close(12);
  node.remove();
  vi.unstubAllGlobals();
});

it.each<WorkspaceEnv>([
  LOCAL_WORKSPACE,
  remote,
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Build",
      image: "test",
    },
  },
])(
  "creates a terminal with the originating filesystem rather than the ambient environment",
  async (workspace) => {
    await render({ workspace });
    expect(create).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    await act(async () => open("/project/subfolder"));
    expect(create).toHaveBeenCalledExactlyOnceWith(
      "/project/subfolder",
      workspace,
      "main",
    );
    expect(useWorkspaceEnvStore.getState().env).toBe(LOCAL_WORKSPACE);
    expect(openProject).not.toHaveBeenCalled();
  },
);

it("passes namespaces to the existing owned project-terminal service without local creation", async () => {
  await render({ folder: "remote://host/project", workspace: LOCAL_WORKSPACE });
  await act(async () => open("remote://host/project/subfolder"));
  expect(openProject).toHaveBeenCalledExactlyOnceWith(
    "remote://host/project/subfolder",
    { isCurrent: expect.any(Function) },
  );
  expect(openProject.mock.calls[0][1].isCurrent()).toBe(true);
  expect(create).not.toHaveBeenCalled();
});

it.each(["source", "root", "workspace", "selection", "unmount", "remove"])(
  "retires namespace admission after %s changes and return",
  async (change) => {
    await render();
    let finish!: () => void;
    openProject.mockImplementation(async (_path, options) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (options.isCurrent()) create("unexpected");
    });
    let result!: Promise<void>;
    await act(async () => {
      result = open("remote://host/project");
    });
    if (change === "source") {
      await render({ selectedKey: "other" });
      await render();
    }
    if (change === "root") {
      await render({ folder: "/different" });
      await render();
    }
    if (change === "workspace") {
      await render({ workspace: LOCAL_WORKSPACE });
      await render();
    }
    if (change === "unmount") await act(async () => root.render(null));
    if (change === "selection")
      await act(async () => {
        useSpaces.setState({ activeId: "other" });
        useSpaces.setState({ activeId: "main" });
      });
    if (change === "remove")
      await act(async () => {
        const spaces = useSpaces.getState().spaces;
        useSpaces.setState({ spaces: [] });
        useSpaces.setState({ spaces });
      });
    await act(async () => {
      finish();
      await result;
    });
    expect(openProject.mock.calls[0][1].isCurrent()).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  },
);

it("rejects a retained callback after its origin changes", async () => {
  await render();
  const old = open;
  await render({ folder: "/other" });
  await act(async () => old("/project"));
  expect(create).not.toHaveBeenCalled();
  await act(async () => open("/other"));
  expect(create).toHaveBeenCalledOnce();
});

it.each(["", "bad\npath", "x".repeat(32769)])(
  "rejects invalid folders without creation",
  async (path) => {
    await render();
    await act(async () => open(path));
    expect(onError).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  },
);

it("declines serial paths without replacing them with local terminals", async () => {
  await render({
    workspace: { kind: "serial", portName: "COM1", baudRate: 9600 },
  });
  await act(async () => open("/project"));
  expect(onError).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
});

it("shows generic current failure and suppresses late failure after retirement", async () => {
  await render();
  create.mockImplementationOnce(() => {
    throw new Error("private path");
  });
  await act(async () => open("/project"));
  expect(onError).toHaveBeenCalledExactlyOnceWith();
  onError.mockClear();
  let fail!: (error: Error) => void;
  openProject.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  let result!: Promise<void>;
  await act(async () => {
    result = open("remote://host/project");
  });
  await render({ selectedKey: "other" });
  await act(async () => {
    fail(new Error("private failure"));
    await result;
  });
  expect(onError).not.toHaveBeenCalled();
});

it("does not turn an unresolved namespace host path into a local directory", async () => {
  await render({ folder: "remote://host/project", workspace: LOCAL_WORKSPACE });
  await act(async () => open("/project/subfolder"));
  expect(create).not.toHaveBeenCalled();
  expect(openProject).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
});

it("keeps a namespace independent of the surrounding serial workspace", async () => {
  await render({
    folder: "remote://host/project",
    workspace: { kind: "serial", portName: "COM1", baudRate: 9600 },
  });
  await act(async () => open("remote://host/project/subfolder"));
  expect(openProject).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it.each([false, true])(
  "integrates the owned project service with retirement=%s",
  async (retire) => {
    const uri = "remote://voktty-ssh-build/project";
    const release = vi.fn().mockResolvedValue(undefined);
    let finish!: (target: unknown) => void;
    mocks.resolve.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    let tab: Tab | undefined;
    const newTab = vi.fn(
      (cwd?: string, workspaceEnv?: WorkspaceEnv, projectCwd?: string) => {
        tab = {
          ...createTabIdentity("main", () => "terminal"),
          id: 11,
          spaceId: "main",
          kind: "terminal",
          title: "shell",
          cwd,
          workspaceEnv,
          projectCwd,
          activeLeafId: 12,
          paneTree: { kind: "leaf", id: 12, cwd },
        };
        return 11;
      },
    );
    const source: Tab = {
      ...createTabIdentity("main", () => "harness"),
      id: 1,
      kind: "harness",
      spaceId: "main",
      title: "Harness",
      cwd: uri,
    };
    const rollback = vi.fn();
    function Integrated({ selected = "source" }: { selected?: string }) {
      const service = useProjectTerminalRequests({
        source,
        spaceId: "main",
        projectCwd: uri,
        newTab,
        getTab: () => tab,
        closeTab: rollback,
        setActiveSpaceForNewTabs: () => {},
        pick: async () => null,
        cancelPicker: () => {},
        onError,
      });
      open = useDirectoryTerminalOpening({
        spaceId: "main",
        selectedKey: selected,
        root: uri,
        workspace: LOCAL_WORKSPACE,
        create,
        openProject: service,
        onError,
      });
      return null;
    }
    await act(async () =>
      root.render(
        <StrictMode>
          <Integrated />
        </StrictMode>,
      ),
    );
    let result!: Promise<void>;
    await act(async () => {
      result = open(uri);
    });
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
    if (retire)
      await act(async () =>
        root.render(
          <StrictMode>
            <Integrated selected="other" />
          </StrictMode>,
        ),
      );
    await act(async () => {
      finish({
        cwd: "/project",
        workspace: remote,
        lease: { release: () => {}, releaseAndClose: release },
      });
      await result;
    });
    expect(create).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    if (retire) {
      expect(newTab).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
      expect(ownedPtyTargets.get(12)).toBeUndefined();
    } else {
      expect(newTab).toHaveBeenCalledExactlyOnceWith(
        "/project",
        remote,
        uri,
        undefined,
      );
      expect(ownedPtyTargets.get(12)?.isCurrent()).toBe(true);
      expect(release).not.toHaveBeenCalled();
      await ownedPtyTargets.close(12);
      expect(release).toHaveBeenCalledOnce();
    }
    expect(rollback).not.toHaveBeenCalled();
  },
);
