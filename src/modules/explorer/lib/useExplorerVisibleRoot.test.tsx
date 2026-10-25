// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExplorerVisibleRoot } from "@/modules/explorer/lib/useExplorerVisibleRoot";
import type { WorkspaceEnv } from "@/modules/workspace";

let root: Root;
let view: ReturnType<typeof useExplorerVisibleRoot>;
const committed = vi.fn();
const local: WorkspaceEnv = { kind: "local" };
function Probe({
  path = "/work",
  workspace = local,
  reachable = true,
  navigationKey = "main",
}: {
  path?: string | null;
  workspace?: WorkspaceEnv;
  reachable?: boolean;
  navigationKey?: string;
}) {
  view = useExplorerVisibleRoot({
    sourceRoot: path,
    sourceReachable: reachable,
    workspace,
    navigationKey,
  });
  useLayoutEffect(() => {
    committed(view.rootPath, workspace);
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  committed.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each(["/next", "C:/next", "//server/share/next"])(
  "commits the current source immediately for %s",
  async (path) => {
    await act(async () => root.render(<Probe />));
    committed.mockClear();
    await act(async () => root.render(<Probe path={path} />));
    expect(committed).toHaveBeenCalledExactlyOnceWith(path, local);
  },
);

it("uses the new SSH root when its source cwd is not reachable", async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => view.navigate("/manual"));
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/remote",
    sessionId: 9,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  committed.mockClear();
  await act(async () =>
    root.render(
      <Probe path="/outside" workspace={workspace} reachable={false} />,
    ),
  );
  expect(committed).toHaveBeenCalledExactlyOnceWith("/remote", workspace);
});

it("retires cached navigation across a context round trip", async () => {
  await act(async () => root.render(<Probe />));
  const original = view.navigate;
  await act(async () => root.render(<Probe navigationKey="other" />));
  await act(async () => root.render(<Probe />));
  await act(async () => original("/stale"));
  expect(view.rootPath).toBe("/work");
  await act(async () => view.navigate("/current"));
  expect(view.rootPath).toBe("/current");
});

it("refuses navigation after unmount", async () => {
  await act(async () => root.render(<Probe />));
  const original = view.navigate;
  await act(async () => root.render(null));
  committed.mockClear();
  await act(async () => original("/stale"));
  expect(committed).not.toHaveBeenCalled();
});

it("preserves the visible remote route while an unreachable cwd needs preparation", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/work",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  await act(async () => root.render(<Probe workspace={workspace} />));
  await act(async () =>
    root.render(
      <Probe path="/outside" workspace={workspace} reachable={false} />,
    ),
  );
  expect(view.rootPath).toBe("/work");
});

it("retires a captured navigation when the same SSH profile changes host", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/work",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  await act(async () => root.render(<Probe workspace={workspace} />));
  const original = view.navigate;
  await act(async () => view.navigate("/manual"));
  const replacement: WorkspaceEnv = {
    ...workspace,
    connection: { ...workspace.connection, host: "other.example" },
  };
  await act(async () => root.render(<Probe workspace={replacement} />));
  await act(async () => original("/stale"));
  expect(view.rootPath).toBe("/work");
});

it.each([false, true])(
  "preserves navigation across its SSH helper widening (committed first=%s)",
  async (committedFirst) => {
    const workspace: WorkspaceEnv = {
      kind: "ssh",
      root: "/work",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    };
    await act(async () => root.render(<Probe workspace={workspace} />));
    const navigate = view.navigate;
    const wider: WorkspaceEnv = { ...workspace, root: "/", sessionId: 8 };
    if (committedFirst) {
      await act(async () => root.render(<Probe workspace={wider} />));
      await act(async () => navigate("/"));
    } else {
      await act(async () => {
        navigate("/");
        root.render(<Probe workspace={wider} />);
      });
    }
    expect(view.rootPath).toBe("/");
  },
);
