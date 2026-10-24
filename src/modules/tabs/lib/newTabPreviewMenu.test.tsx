// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TabBar } from "@/modules/tabs/TabBar";
import { VerticalTabBar } from "@/modules/tabs/VerticalTabBar";
import { t } from "@/modules/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/agents/components/AgentLauncherPanel", () => ({
  AgentLauncherPanel: () => null,
}));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  useAiAvailable: () => false,
}));

let root: Root;
let node: HTMLDivElement;
const preview = vi.fn();
const browser = vi.fn();
const no = () => {};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  preview.mockClear();
  browser.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

async function render(direction: "horizontal" | "vertical", reason?: string) {
  const props = {
    tabs: [],
    activeId: -1,
    onSelect: no,
    onClose: no,
    onCloseTabsToRight: no,
    onCloseOtherTabs: no,
    onDuplicate: no,
    onPin: no,
    onRename: no,
    onReorder: no,
    onNew: no,
    onNewBlock: no,
    onNewPrivate: no,
    onNewEditor: no,
    onLaunchAgents: no,
    onNewPreview: preview,
    previewDisabledReason: reason,
    onNewBrowser: browser,
  };
  await act(async () =>
    root.render(
      direction === "horizontal" ? (
        <TabBar {...props} />
      ) : (
        <VerticalTabBar {...props} />
      ),
    ),
  );
}
async function openMenu() {
  const trigger = node.querySelector<HTMLElement>(
    `[aria-label="${t("tabs.newTab")}"]`,
  );
  expect(trigger).not.toBeNull();
  await act(async () =>
    trigger?.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
      }),
    ),
  );
}
function item(label: string) {
  const result = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((element) => element.textContent?.startsWith(label));
  if (!result) throw new Error(`Missing menu item: ${label}`);
  return result;
}

for (const direction of ["horizontal", "vertical"] as const) {
  it(`offers browser and project preview independently in the ${direction} menu`, async () => {
    await render(direction);
    await openMenu();
    await act(async () =>
      item(t("commandPalette.commands.newWebPreview")).click(),
    );
    expect(preview).toHaveBeenCalledOnce();
    expect(browser).not.toHaveBeenCalled();
    await openMenu();
    await act(async () => item(t("tabs.newBrowser")).click());
    expect(browser).toHaveBeenCalledOnce();
    expect(preview).toHaveBeenCalledOnce();
  });

  it.each(["editor.status.previewNotSupported", "spaces.maxSlots"])(
    `shows %s and blocks only project preview in the ${direction} menu`,
    async (key) => {
      await render(direction, t(key));
      await openMenu();
      const denied = item(t("commandPalette.commands.newWebPreview"));
      expect(denied.getAttribute("aria-disabled")).toBe("true");
      expect(denied.textContent).toContain(t(key));
      await act(async () => denied.click());
      expect(preview).not.toHaveBeenCalled();
      await act(async () => item(t("tabs.newBrowser")).click());
      expect(browser).toHaveBeenCalledOnce();
      await render(direction);
      await openMenu();
      const allowed = item(t("commandPalette.commands.newWebPreview"));
      expect(allowed.getAttribute("aria-disabled")).not.toBe("true");
      await act(async () => allowed.click());
      expect(preview).toHaveBeenCalledOnce();
    },
  );
}
