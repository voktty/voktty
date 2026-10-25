// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExplorerRepositoryInitialization } from "@/modules/explorer/lib/useExplorerRepositoryInitialization";
import type { WorkspaceEnv } from "@/modules/workspace";

const init = vi.hoisted(() => vi.fn());
vi.mock("@/modules/ai/lib/native", () => ({ native: { gitInit: init } }));
let root: Root;
let action: ReturnType<typeof useExplorerRepositoryInitialization>;
const success = vi.fn();
const error = vi.fn();
const scope = {};
function Probe({
  workspace,
  path = "/project",
  enabled = true,
}: {
  workspace: WorkspaceEnv;
  path?: string;
  enabled?: boolean;
}) {
  action = useExplorerRepositoryInitialization({
    scope,
    rootPath: path,
    workspace,
    enabled,
    onSuccess: success,
    onError: error,
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  init.mockReset().mockResolvedValue(undefined);
  success.mockReset();
  error.mockReset();
  root = createRoot(document.createElement("div"));
});
it("refuses unknown repository admission and never revives its cached action", async () => {
  const workspace: WorkspaceEnv = { kind: "local" };
  await act(async () => root.render(<Probe workspace={workspace} />));
  const old = action.run;
  await act(async () =>
    root.render(<Probe workspace={workspace} enabled={false} />),
  );
  expect(action.available).toBe(false);
  await act(async () => {
    await old();
    await action.run();
  });
  expect(init).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe workspace={workspace} />));
  await act(async () => old());
  expect(init).not.toHaveBeenCalled();
  await act(async () => action.run());
  expect(init).toHaveBeenCalledOnce();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it.each<WorkspaceEnv>([
  { kind: "local" },
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    root: "/project",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
])(
  "initializes with the explicit $kind Explorer filesystem",
  async (workspace) => {
    await act(async () => root.render(<Probe workspace={workspace} />));
    await act(async () => action.run());
    expect(init).toHaveBeenCalledExactlyOnceWith("/project", workspace);
    expect(init.mock.calls[0][1]).not.toBe(workspace);
    expect(success).toHaveBeenCalledOnce();
  },
);
it.each([
  "remote://unknown/project",
  "relative",
  "ssh://host/project",
  "/bad\0path",
])("rejects an unsupported target %s without local IO", async (path) => {
  await act(async () =>
    root.render(<Probe workspace={{ kind: "local" }} path={path} />),
  );
  expect(action.available).toBe(false);
  await act(async () => action.run());
  expect(init).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});
it("retires pending feedback when only the filesystem changes", async () => {
  let done!: () => void;
  init.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  let pending!: Promise<void>;
  await act(async () => {
    pending = action.run();
  });
  await act(async () =>
    root.render(<Probe workspace={{ kind: "wsl", distro: "Ubuntu" }} />),
  );
  await act(async () => {
    done();
    await pending;
  });
  expect(success).not.toHaveBeenCalled();
});

it.each<WorkspaceEnv>([
  { kind: "serial", portName: "port", baudRate: 9600 },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])("refuses unsupported $kind initialization", async (workspace) => {
  await act(async () => root.render(<Probe workspace={workspace} />));
  expect(action.available).toBe(false);
  await act(async () => action.run());
  expect(init).not.toHaveBeenCalled();
});

it.each([
  "C:/project",
  "//server/share/project",
  "remote://voktty-ssh-build/project",
])("preserves the explicit destination %s", async (path) => {
  await act(async () =>
    root.render(<Probe workspace={{ kind: "local" }} path={path} />),
  );
  await act(async () => action.run());
  expect(init).toHaveBeenCalledExactlyOnceWith(path, { kind: "local" });
});

it("does not notify after a refresh listener retires the Explorer", async () => {
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  const retire = () => flushSync(() => root.render(null));
  window.addEventListener("voktty:git-refresh", retire);
  try {
    await act(async () => action.run());
    expect(init).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("voktty:git-refresh", retire);
  }
});

it("publishes no refresh or success before native acknowledgement", async () => {
  const refresh = vi.fn();
  let done!: () => void;
  init.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  window.addEventListener("voktty:git-refresh", refresh);
  try {
    await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
    let pending!: Promise<void>;
    await act(async () => {
      pending = action.run();
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    await act(async () => {
      done();
      await pending;
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("voktty:git-refresh", refresh);
  }
});

it("preserves a current native failure without success feedback", async () => {
  const reason = new Error("Native failure");
  init.mockRejectedValue(reason);
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  await act(async () => action.run());
  expect(error).toHaveBeenCalledExactlyOnceWith(reason);
  expect(success).not.toHaveBeenCalled();
});
