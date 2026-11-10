// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTabCloseGuards } from "@/app/hooks/useTabCloseGuards";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { HarnessTab, Tab } from "@/modules/tabs/lib/useTabs";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/modules/harness/lib/harnessControlBridge", () => ({
  getHarnessSessionSnapshot: vi.fn((sessionId: string) => {
    if (sessionId === "busy-session") {
      return { sessionId, state: "working" };
    }
    if (sessionId === "idle-session") {
      return { sessionId, state: "idle" };
    }
    return null;
  }),
}));

let root: Root;
let node: HTMLDivElement;
let guards: ReturnType<typeof useTabCloseGuards>;
const disposeTab = vi.fn();

function harnessTab(
  id: number,
  sessionId: string,
): HarnessTab {
  return {
    id,
    ...createTabIdentity("main", () => String(id)),
    kind: "harness",
    spaceId: "main",
    title: "Agent tab",
    sessionId,
  };
}

function Host({ tabs }: { tabs: Tab[] }) {
  guards = useTabCloseGuards({
    tabs,
    activeId: 1,
    disposeTab,
    disposeTabs: () => {},
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  disposeTab.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

describe("harnessTabCloseGuard", () => {
  it("does not dispose a busy harness tab without confirmation", async () => {
    const tabs: Tab[] = [harnessTab(1, "busy-session")];
    await act(async () => {
      root.render(<Host tabs={tabs} />);
    });

    await act(async () => {
      await guards.handleClose(1);
    });

    // disposeTab should NOT have been called directly
    expect(disposeTab).not.toHaveBeenCalled();
    // pendingTerminalCloseTab should be set to 1 for confirmation prompt
    expect(guards.pendingTerminalCloseTab).toBe(1);
  });

  it("disposes an idle harness tab directly without confirmation", async () => {
    const tabs: Tab[] = [harnessTab(2, "idle-session")];
    await act(async () => {
      root.render(<Host tabs={tabs} />);
    });

    await act(async () => {
      await guards.handleClose(2);
    });

    expect(disposeTab).toHaveBeenCalledWith(2);
    expect(guards.pendingTerminalCloseTab).toBeNull();
  });
});
