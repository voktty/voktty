// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewEditorPane } from "@/modules/editor/components/PreviewEditorPane";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { EditorTab } from "@/modules/tabs/lib/useTabs";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import type {
  PreviewDocumentAction,
  PreviewOpeningAction,
} from "@/modules/preview/lib/previewOpeningTarget";
const capture = vi.hoisted(() => ({
  action: undefined as PreviewDocumentAction | undefined,
}));
vi.mock("@/modules/editor/EditorPane", () => ({
  EditorPane: (props: { onOpenPreview?: PreviewDocumentAction }) => {
    capture.action = props.onOpenPreview;
    return null;
  },
}));
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original: EditorTab = {
    id: 200,
    ...createTabIdentity("source"),
    spaceId: "source",
    kind: "editor",
    title: "Page",
    path: "/source/page.html",
    dirty: false,
    preview: false,
    workspaceEnv: LOCAL_WORKSPACE,
  };
  const root = createRoot(document.createElement("div"));
  const open = vi.fn<PreviewOpeningAction>();
  const render = (tab = original, visible = true) =>
    act(async () =>
      root.render(
        <PreviewEditorPane
          tab={tab}
          visible={visible}
          editorId={tab.id}
          spaceId={tab.spaceId}
          path={tab.path}
          workspaceEnv={tab.workspaceEnv ?? LOCAL_WORKSPACE}
          onOpenPreview={open}
        />,
      ),
    );
  await render();
  const action = () => {
    if (!capture.action) throw new Error("Document action absent");
    return capture.action;
  };
  return {
    original,
    open,
    render,
    action,
    close: async () => act(async () => root.unmount()),
  };
}
it("passes the pointed editor and keeps its callback stable through unrelated dirty metadata", async () => {
  const f = await setup();
  try {
    const action = f.action();
    const dirty = { ...f.original, dirty: true };
    await f.render(dirty);
    expect(f.action()).toBe(action);
    await action(dirty.path);
    expect(f.open.mock.calls[0][1]?.source).toBe(dirty);
    expect(f.open.mock.calls[0][1]?.current?.()).toBe(true);
  } finally {
    await f.close();
  }
});
it.each(["path", "visibility"] as const)(
  "retires an old %s receipt permanently when the editor returns",
  async (change) => {
    const f = await setup();
    try {
      const old = f.action();
      await old(f.original.path);
      const permit = f.open.mock.calls[0][1]?.current;
      await f.render(
        change === "path"
          ? { ...f.original, path: "/other/page.html" }
          : f.original,
        change !== "visibility",
      );
      await f.render();
      expect(permit?.()).toBe(false);
      await old(f.original.path);
      expect(f.open).toHaveBeenCalledOnce();
      await f.action()(f.original.path);
      expect(f.open).toHaveBeenCalledTimes(2);
    } finally {
      await f.close();
    }
  },
);
it("combines the button permit with the mounted editor receipt", async () => {
  const f = await setup();
  let buttonCurrent = true;
  await f.action()(f.original.path, () => buttonCurrent);
  const permit = f.open.mock.calls[0][1]?.current;
  buttonCurrent = false;
  expect(permit?.()).toBe(false);
  await f.close();
  buttonCurrent = true;
  expect(permit?.()).toBe(false);
});
