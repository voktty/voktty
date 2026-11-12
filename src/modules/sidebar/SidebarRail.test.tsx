// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarRail } from "@/modules/sidebar/SidebarRail";
import type { SidebarViewId } from "@/modules/sidebar/types";

vi.mock("@/modules/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it("keeps all views accessible and lets the active view close and reopen", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const [active, setActive] = useState<SidebarViewId | null>("explorer");
    return <TooltipProvider><SidebarRail activeView={active} onSelectView={(view) => setActive(active === view ? null : view)} changedCount={3} workspaceRoot={null} /></TooltipProvider>;
  }
  try {
    await act(async () => root.render(<Fixture />));
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(6);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "sidebar.files", "sidebar.search", "sidebar.outline", "sidebar.problems", "sidebar.runDebug", "sidebar.git",
    ]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0].firstElementChild?.className).toContain("bg-content/10");
    expect(buttons[1].firstElementChild?.className).toContain("group-hover:bg-content/10");
    expect(buttons[1].firstElementChild?.className).toContain("group-focus-visible:ring-2");
    expect(buttons[5].textContent).toContain("3");
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[0].click());
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[0].firstElementChild?.className).not.toContain("bg-content/10 text-content");
    await act(async () => buttons[0].click());
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("pins the footer below the view icons", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <SidebarRail
            activeView="explorer"
            onSelectView={() => {}}
            changedCount={0}
            workspaceRoot={null}
            footer={<span data-testid="rail-footer">0H</span>}
          />
        </TooltipProvider>,
      ),
    );
    const footer = container.querySelector('[data-testid="rail-footer"]');
    expect(footer).not.toBeNull();
    const views = container.querySelectorAll("button");
    const lastView = views[views.length - 1];
    if (!lastView || !footer) throw new Error("Missing rail elements");
    expect(
      lastView.compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
