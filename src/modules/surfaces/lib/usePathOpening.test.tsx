// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePathOpening } from "@/modules/surfaces/lib/usePathOpening";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import {
  PATH_OPENING_EVENT,
  pathOpeningRequest,
  requestPathOpening,
} from "@/modules/surfaces/lib/pathOpeningRequest";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ kind: vi.fn() }));
vi.mock("@/modules/surfaces/lib/pathOpeningFilesystem", () => ({
  pathOpeningKind: mocks.kind,
}));
const openFile = vi.fn();
const openDirectory = vi.fn();
const onError = vi.fn();
let node: HTMLDivElement;
let root: Root;
let open: ReturnType<typeof usePathOpening>;
function Probe({ sourceKey = "source" }: { sourceKey?: string }) {
  open = usePathOpening({
    spaceId: "main",
    sourceKey,
    openFile,
    openDirectory,
    onError,
  });
  return null;
}
async function render(sourceKey = "source") {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe sourceKey={sourceKey} />
      </StrictMode>,
    ),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  sessionId: 7,
  connection: { id: "build", name: "Build", host: "build.example" },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.kind.mockReset().mockResolvedValue("file");
  openFile.mockReset();
  openDirectory.mockReset();
  onError.mockReset();
  useSpaces.setState({
    activeId: "main",
    spaces: [
      {
        id: "main",
        name: "Main",
        root: "/project",
        env: ssh,
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
  node.remove();
  vi.unstubAllGlobals();
});

it.each<WorkspaceEnv>([
  LOCAL_WORKSPACE,
  ssh,
  { kind: "wsl", distro: "Ubuntu" },
])(
  "opens with the request filesystem rather than the selected SSH space",
  async (workspace) => {
    await render();
    await act(async () =>
      open(pathOpeningRequest("/project/file.ts", workspace)),
    );
    expect(mocks.kind).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ workspace }),
      expect.any(Function),
    );
    expect(openFile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: "/project/file.ts", workspace }),
    );
    expect(useSpaces.getState().spaces[0].env).toBe(ssh);
    expect(openDirectory).not.toHaveBeenCalled();
  },
);

it("delivers trusted events once and rejects unqualified, fabricated and replayed payloads", async () => {
  await render();
  let captured: unknown;
  const capture = (event: Event) => {
    captured = (event as CustomEvent).detail;
  };
  window.addEventListener(PATH_OPENING_EVENT, capture);
  try {
    await act(async () =>
      requestPathOpening("remote://host/project/file.ts", ssh),
    );
    expect(openFile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        path: "remote://host/project/file.ts",
        workspace: LOCAL_WORKSPACE,
      }),
    );
    openFile.mockClear();
    for (const detail of [
      "/project/file.ts",
      {},
      { path: "/project/file.ts", workspace: LOCAL_WORKSPACE },
      captured,
    ]) {
      await act(async () => {
        window.dispatchEvent(new CustomEvent(PATH_OPENING_EVENT, { detail }));
      });
    }
    expect(openFile).not.toHaveBeenCalled();
    expect(mocks.kind).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(PATH_OPENING_EVENT, capture);
  }
});
it("resolves an OS drop batch before opening its first file can change the selected source", async () => {
  await render();
  const first = deferred<"file">();
  const second = deferred<"file">();
  mocks.kind
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await act(async () => {
    requestPathOpening("/native/first.ts", LOCAL_WORKSPACE, "unknown");
    requestPathOpening("/native/second.ts", LOCAL_WORKSPACE, "unknown");
  });
  await act(async () => {
    first.resolve("file");
  });
  expect(openFile).not.toHaveBeenCalled();
  openFile.mockImplementation(() =>
    root.render(
      <StrictMode>
        <Probe sourceKey="created" />
      </StrictMode>,
    ),
  );
  await act(async () => {
    second.resolve("file");
  });
  expect(openFile.mock.calls.map(([request]) => request.path)).toEqual([
    "/native/first.ts",
    "/native/second.ts",
  ]);
});
it("counts queued event paths against direct read admission and retains the batch until settlement", async () => {
  await render();
  const pending = deferred<"file">();
  mocks.kind.mockReturnValue(pending.promise);
  await act(async () => {
    for (let i = 0; i < 257; i++)
      requestPathOpening(`/native/${i}.ts`, LOCAL_WORKSPACE, "unknown");
    await open(pathOpeningRequest("/native/direct.ts", LOCAL_WORKSPACE));
  });
  expect(mocks.kind).toHaveBeenCalledTimes(256);
  await render("replacement");
  await act(async () => {
    pending.resolve("file");
  });
  expect(openFile).not.toHaveBeenCalled();
  mocks.kind.mockResolvedValue("file");
  await act(async () =>
    open(pathOpeningRequest("/native/current.ts", LOCAL_WORKSPACE)),
  );
  expect(openFile).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ path: "/native/current.ts" }),
  );
});
it("preserves successful siblings of a failed batch lookup without a fallback for the failed path", async () => {
  await render();
  mocks.kind
    .mockRejectedValueOnce(new Error("private path"))
    .mockResolvedValueOnce("file");
  await act(async () => {
    requestPathOpening("/native/missing.ts", LOCAL_WORKSPACE, "unknown");
    requestPathOpening("/native/found.ts", LOCAL_WORKSPACE, "unknown");
  });
  expect(openFile).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ path: "/native/found.ts" }),
  );
  expect(onError).toHaveBeenCalledExactlyOnceWith();
});
it("retires queued event delivery when the space changes and returns before the microtask", async () => {
  await render();
  await act(async () => {
    requestPathOpening("/native/file.ts", LOCAL_WORKSPACE, "unknown");
    useSpaces.getState().setRoot("main", "/other");
    useSpaces.getState().setRoot("main", "/project");
  });
  expect(mocks.kind).not.toHaveBeenCalled();
  expect(openFile).not.toHaveBeenCalled();
});

it("admits a directory context update atomically under the original permit", async () => {
  await render();
  mocks.kind.mockResolvedValue("dir");
  const created = vi.fn();
  openDirectory.mockImplementation((request, current) => {
    if (
      useSpaces
        .getState()
        .setContext("main", request.path, request.workspace, current)
    )
      created(request);
  });
  await act(async () => open(pathOpeningRequest("/native", LOCAL_WORKSPACE)));
  expect(useSpaces.getState().spaces[0]).toMatchObject({
    root: "/native",
    env: LOCAL_WORKSPACE,
  });
  expect(created).toHaveBeenCalledOnce();
  expect(openFile).not.toHaveBeenCalled();
});

it.each([
  "source",
  "selection",
  "root",
  "environment",
  "remove",
  "incarnation",
  "unmount",
])(
  "permanently retires a pending result after %s changes and returns",
  async (change) => {
    await render();
    const pending = deferred<"file" | "dir">();
    mocks.kind.mockReturnValue(pending.promise);
    let result!: Promise<void>;
    await act(async () => {
      result = open(pathOpeningRequest("/project/file.ts", ssh));
    });
    if (change === "source") {
      await render("other");
      await render();
    }
    if (change === "unmount") await act(async () => root.render(null));
    await act(async () => {
      if (change === "selection") {
        useSpaces.setState({ activeId: "other" });
        useSpaces.setState({ activeId: "main" });
      }
      if (change === "root") {
        useSpaces.getState().setRoot("main", "/other");
        useSpaces.getState().setRoot("main", "/project");
      }
      if (change === "environment") {
        useSpaces.getState().setEnv("main", LOCAL_WORKSPACE);
        useSpaces.getState().setEnv("main", ssh);
      }
      if (change === "remove") {
        const spaces = useSpaces.getState().spaces;
        useSpaces.setState({ spaces: [] });
        useSpaces.setState({ spaces });
      }
      if (change === "incarnation") {
        useSpaces.setState({
          spaces: useSpaces
            .getState()
            .spaces.map((space) => ({ ...space, createdAt: 2 })),
        });
      }
      pending.resolve("file");
      await result;
    });
    expect(openFile).not.toHaveBeenCalled();
    expect(openDirectory).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  },
);

it("rejects a retained callback and a background-space request before IO", async () => {
  await render();
  const old = open;
  await render("replacement");
  await act(async () => old(pathOpeningRequest("/project/file.ts", ssh)));
  useSpaces.setState({ activeId: "other" });
  await act(async () => open(pathOpeningRequest("/project/file.ts", ssh)));
  expect(mocks.kind).not.toHaveBeenCalled();
  expect(openFile).not.toHaveBeenCalled();
});

it.each([false, true])(
  "reports only a current failure, retired=%s, without opening a local fallback",
  async (retired) => {
    await render();
    const pending = deferred<"file">();
    mocks.kind.mockReturnValue(pending.promise);
    let result!: Promise<void>;
    await act(async () => {
      result = open(pathOpeningRequest("/project/file.ts", ssh));
    });
    if (retired) await render("replacement");
    await act(async () => {
      pending.reject(new Error("private path"));
      await result;
    });
    expect(onError).toHaveBeenCalledTimes(retired ? 0 : 1);
    if (!retired) expect(onError).toHaveBeenCalledWith();
    expect(openFile).not.toHaveBeenCalled();
    expect(openDirectory).not.toHaveBeenCalled();
  },
);

it("retains all 256 retired read slots until actual settlement", async () => {
  await render();
  const pending = deferred<"file">();
  mocks.kind.mockReturnValue(pending.promise);
  const results: Promise<void>[] = [];
  await act(async () => {
    for (let i = 0; i < 256; i++)
      results.push(open(pathOpeningRequest(`/project/${i}`, ssh)));
  });
  await render("replacement");
  await act(async () => open(pathOpeningRequest("/project/overflow", ssh)));
  expect(mocks.kind).toHaveBeenCalledTimes(256);
  await act(async () => {
    pending.resolve("file");
    await Promise.all(results);
  });
  expect(openFile).not.toHaveBeenCalled();
  mocks.kind.mockResolvedValue("file");
  await act(async () => open(pathOpeningRequest("/project/accepted", ssh)));
  expect(openFile).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ path: "/project/accepted" }),
  );
});

it.each<WorkspaceEnv>([
  { kind: "serial", portName: "COM1", baudRate: 9600 },
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Build",
      image: "test",
    },
  },
])("rejects unsupported filesystem requests before IO", async (workspace) => {
  await render();
  await act(async () =>
    open(pathOpeningRequest("/project/file.ts", workspace)),
  );
  expect(mocks.kind).not.toHaveBeenCalled();
  expect(openFile).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
});
