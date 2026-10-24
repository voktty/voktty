// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LivePreviewButton } from "@/modules/preview/components/LivePreviewButton";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import type { PreviewDocumentAction } from "@/modules/preview/lib/previewOpeningTarget";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function setup(
  action: PreviewDocumentAction,
  workspace: WorkspaceEnv = LOCAL_WORKSPACE,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  const render = (path = "/project/page.html") =>
    act(async () =>
      root.render(
        <LivePreviewButton
          path={path}
          workspace={workspace}
          onOpenPreview={action}
        />,
      ),
    );
  await render();
  const button = () => {
    const result = node.querySelector("button");
    if (!result) throw new Error("Preview button absent");
    return result;
  };
  return { render, button, close: async () => act(async () => root.unmount()) };
}
it("delegates the document path and permit without starting native resources", async () => {
  let finish!: () => void;
  const action = vi.fn<PreviewDocumentAction>().mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const f = await setup(action);
  try {
    await act(async () => {
      f.button().click();
      f.button().click();
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0][0]).toBe("/project/page.html");
    expect(action.mock.calls[0][1]?.()).toBe(true);
    expect(f.button().disabled).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(f.button().disabled).toBe(false);
  } finally {
    await f.close();
  }
});
it.each<WorkspaceEnv>([
  { kind: "wsl", distro: "Debian" },
  {
    kind: "ssh",
    root: "/project",
    connection: { id: "host", name: "Host", host: "example.test" },
  },
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Container",
      image: "image",
    },
  },
  { kind: "serial", portName: "COM3", baudRate: 9600 },
])(
  "disables Play with a local-machine restriction for $kind",
  async (workspace) => {
    const action = vi.fn();
    const f = await setup(action, workspace);
    try {
      expect(f.button().disabled).toBe(true);
      expect(f.button().title).toBe("Local Machine");
      await act(async () => f.button().click());
      expect(action).not.toHaveBeenCalled();
      expect(mocks.invoke).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);
it("does not let a retired click clear the loading state of its successor", async () => {
  let first!: () => void;
  let second!: () => void;
  const action = vi
    .fn<PreviewDocumentAction>()
    .mockReturnValueOnce(
      new Promise<void>((resolve) => {
        first = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise<void>((resolve) => {
        second = resolve;
      }),
    );
  const f = await setup(action);
  try {
    await act(async () => f.button().click());
    const oldPermit = action.mock.calls[0][1];
    await f.render("/other/page.html");
    expect(oldPermit?.()).toBe(false);
    await act(async () => f.button().click());
    await act(async () => first());
    expect(f.button().disabled).toBe(true);
    await act(async () => second());
    expect(f.button().disabled).toBe(false);
  } finally {
    await f.close();
  }
});
it("observes failures after unmount without publishing a late notification", async () => {
  let fail!: (error: Error) => void;
  const action = vi.fn<PreviewDocumentAction>().mockReturnValue(
    new Promise((_yes, no) => {
      fail = no;
    }),
  );
  const f = await setup(action);
  await act(async () => f.button().click());
  await f.close();
  expect(action.mock.calls[0][1]?.()).toBe(false);
  await act(async () => fail(new Error("Private startup failure")));
  expect(mocks.error).not.toHaveBeenCalled();
});
