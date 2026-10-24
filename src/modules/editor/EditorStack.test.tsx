// @vitest-environment happy-dom
import { act, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  EditorStack,
  type EditorGroupHandle,
} from "@/modules/editor/EditorStack";
import type { EditorTab } from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { WorkspacePlacement } from "@/modules/spaces";
import { asSlotId } from "@/modules/spaces/lib/spaceLayout";

const lifecycle = vi.hoisted(() => ({ mounted: 0, disposed: 0 }));
vi.mock("@/modules/editor/EditorPane", () => ({
  EditorPane: ({ editorId }: { editorId: number }) => {
    const [buffer, setBuffer] = useState("disk");
    useEffect(() => {
      lifecycle.mounted++;
      return () => {
        lifecycle.disposed++;
      };
    }, []);
    return (
      <button
        type="button"
        data-buffer={editorId}
        onClick={() => setBuffer("unsaved")}
      >
        {buffer}
      </button>
    );
  },
}));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div data-resize-handle />,
}));
vi.mock("@/modules/markdown", () => ({ MarkdownViewToggle: () => null }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function editor(id: number, spaceId = "main"): EditorTab {
  return {
    id,
    ...createTabIdentity(spaceId, () => `editor-${id}`),
    spaceId,
    kind: "editor",
    title: "File",
    path: `/repo/file-${id}.ts`,
    dirty: false,
    preview: false,
  };
}

async function setup(measure = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  if (measure) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const groups = [...container.querySelectorAll("[data-editor-group]")];
        const index = groups.indexOf(this);
        return index < 0
          ? new DOMRect(100, 50, 1000, 600)
          : new DOMRect(100 + index * 500, 50, 500, 600);
      },
    );
  }
  const root = createRoot(container);
  let group!: EditorGroupHandle;
  let tabs = [editor(1), editor(2)];
  let active = 1;
  let placements: ReadonlyMap<number, WorkspacePlacement> | undefined;
  const noop = () => {};
  const activate = vi.fn((id: number) => {
    active = id;
  });
  const register = (handle: EditorGroupHandle | null) => {
    if (handle) group = handle;
  };
  const render = () =>
    act(async () =>
      root.render(
        <StrictMode>
          <EditorStack
            tabs={tabs}
            activeId={active}
            onDirtyChange={noop}
            registerHandle={noop}
            registerGroupHandle={register}
            onActivateTab={activate}
            onCloseTab={noop}
            onSetMarkdownView={noop}
            canNavigateBack={false}
            canNavigateForward={false}
            onNavigateBack={noop}
            onNavigateForward={noop}
            placements={placements}
          />
        </StrictMode>,
      ),
    );
  await render();
  const pane = (id: number) =>
    container.querySelector<HTMLButtonElement>(`[data-buffer="${id}"]`);
  const original = pane(1);
  if (!original) throw new Error("Missing editor");
  await act(async () => original.click());
  const baseline = { ...lifecycle };
  return {
    container,
    original,
    pane,
    baseline,
    group: () => group,
    render,
    activate,
    select: (id: number) => {
      active = id;
    },
    updateTabs: (value: EditorTab[]) => {
      tabs = value;
    },
    compose: (value: ReadonlyMap<number, WorkspacePlacement> | undefined) => {
      placements = value;
    },
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("keeps the editor resource and unsaved buffer when switching tabs", async () => {
  const fixture = await setup();
  try {
    fixture.select(2);
    await fixture.render();
    fixture.select(1);
    await fixture.render();
    expect(fixture.pane(1)).toBe(fixture.original);
    expect(fixture.pane(1)?.textContent).toBe("unsaved");
    expect(lifecycle).toEqual(fixture.baseline);
  } finally {
    await fixture.close();
  }
});

it("keeps the editor resource through splits, group focus and collapse", async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.group().split("row"));
    expect(fixture.pane(1)).toBe(fixture.original);
    fixture.select(2);
    await fixture.render();
    await act(async () => fixture.group().focusNext(1));
    await fixture.render();
    await act(async () => fixture.group().closeActive());
    await fixture.render();
    expect(fixture.pane(1)).toBe(fixture.original);
    expect(fixture.pane(1)?.textContent).toBe("unsaved");
    expect(lifecycle).toEqual(fixture.baseline);
    expect(fixture.container.querySelectorAll("[data-buffer]")).toHaveLength(2);
  } finally {
    await fixture.close();
  }
});

it("keeps every editor mounted when entering and leaving a composite", async () => {
  const fixture = await setup();
  try {
    fixture.compose(
      new Map([
        [
          1,
          {
            tabId: 1,
            slotId: asSlotId("slot-one"),
            focused: true,
            rect: { x: 0, y: 0, width: 0.5, height: 1 },
          },
        ],
      ]),
    );
    await fixture.render();
    expect(fixture.pane(1)).toBe(fixture.original);
    fixture.compose(new Map());
    await fixture.render();
    fixture.compose(undefined);
    await fixture.render();
    expect(fixture.pane(1)).toBe(fixture.original);
    expect(fixture.pane(1)?.textContent).toBe("unsaved");
    expect(lifecycle).toEqual(fixture.baseline);
  } finally {
    await fixture.close();
  }
});

it("does not move a selected editor into an empty group when dirty metadata changes", async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.group().split("row"));
    const emptyGroups = fixture.container.textContent;
    const owner = fixture
      .pane(1)
      ?.closest<HTMLElement>("[data-editor-group-owner]")
      ?.dataset.editorGroupOwner;
    expect(owner).toBeDefined();
    fixture.updateTabs([{ ...editor(1), dirty: true }, editor(2)]);
    await fixture.render();
    expect(fixture.container.textContent).toBe(emptyGroups);
    expect(fixture.pane(1)).toBe(fixture.original);
    expect(
      fixture.pane(1)?.closest<HTMLElement>("[data-editor-group-owner]")
        ?.dataset.editorGroupOwner,
    ).toBe(owner);
  } finally {
    await fixture.close();
  }
});

it("uses measured group slots and composite geometry without moving editor nodes", async () => {
  const fixture = await setup(true);
  const wrapper = (id: number) =>
    fixture.pane(id)?.closest<HTMLElement>("[data-space-tab]");
  try {
    expect(wrapper(1)?.style.width).toBe("100%");
    await act(async () => fixture.group().split("row"));
    expect(wrapper(1)?.style.width).toBe("50%");
    expect(wrapper(1)?.style.left).toBe("0%");
    fixture.select(2);
    await fixture.render();
    expect(wrapper(2)?.style.left).toBe("50%");
    fixture.compose(
      new Map([
        [
          1,
          {
            tabId: 1,
            slotId: asSlotId("slot-one"),
            focused: true,
            rect: { x: 0.7, y: 0, width: 0.3, height: 1 },
          },
        ],
      ]),
    );
    await fixture.render();
    expect(wrapper(1)?.style.left).toBe("70%");
    expect(wrapper(2)?.getAttribute("aria-hidden")).toBe("true");
    fixture.compose(undefined);
    await fixture.render();
    expect(fixture.pane(1)).toBe(fixture.original);
    expect(fixture.pane(1)?.textContent).toBe("unsaved");
    expect(lifecycle).toEqual(fixture.baseline);
  } finally {
    await fixture.close();
  }
});

it("releases only a removed editor and keeps moved editors out of their former workspace", async () => {
  const fixture = await setup(true);
  try {
    fixture.updateTabs([editor(1, "other"), editor(2)]);
    await fixture.render();
    fixture.select(2);
    await fixture.render();
    expect(fixture.pane(1)).toBe(fixture.original);
    expect(
      fixture.pane(1)?.closest("[data-space-tab]")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(lifecycle).toEqual(fixture.baseline);
    fixture.updateTabs([editor(1, "other")]);
    await fixture.render();
    expect(fixture.pane(2)).toBeNull();
    expect(fixture.pane(1)).toBe(fixture.original);
    expect(lifecycle.disposed).toBe(fixture.baseline.disposed + 1);
  } finally {
    await fixture.close();
  }
});
