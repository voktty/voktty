import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import { createTerminalPathDropTarget } from "./useTerminalFileDrop";

describe("createTerminalPathDropTarget", () => {
  it("tracks the terminal leaf under the pointer", () => {
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: (x, y) => (x === 20 && y === 30 ? 7 : null),
      paste: vi.fn(),
      setTarget,
    });

    expect(target.updateTarget(20, 30)).toBe(true);
    expect(setTarget).toHaveBeenLastCalledWith(7);
    expect(target.updateTarget(1, 2)).toBe(false);
    expect(setTarget).toHaveBeenLastCalledWith(null);
  });

  it("clears the target and pastes a shell-quoted path", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => 11,
      paste,
      setTarget,
    });

    expect(target.dropPath("/repo/My File.ts", 40, 50)).toBe(true);
    expect(setTarget).toHaveBeenCalledWith(null);
    expect(paste).toHaveBeenCalledWith(11, "'/repo/My File.ts' ");
  });

  it("clears stale state when a drop misses every terminal", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => null,
      paste,
      setTarget,
      isAiChatAtPoint: () => false,
    });

    expect(target.dropPath("/repo/file.ts", 1, 2)).toBe(false);
    expect(setTarget).toHaveBeenCalledWith(null);
    expect(paste).not.toHaveBeenCalled();
  });

  it("attaches dropped file to AI chat when hovering over AI chat drop target", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const attachToAi = vi.fn(() => true);
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => null,
      paste,
      setTarget,
      isAiChatAtPoint: (x) => x > 500,
      attachToAi,
    });

    expect(target.updateTarget(600, 100)).toBe(true);
    expect(setTarget).toHaveBeenCalledWith(null);

    expect(target.dropPath("/repo/app.tsx", 600, 100)).toBe(true);
    expect(attachToAi).toHaveBeenCalledWith("/repo/app.tsx");
    expect(paste).not.toHaveBeenCalled();
  });

  it("uses explorer drops only for terminal and AI targets", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const attachToAi = vi.fn(() => true);
    const openDroppedPath = vi.fn(() => true);
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: (x) => (x === 20 ? 4 : null),
      paste,
      setTarget,
      isAiChatAtPoint: (x) => x === 50,
      attachToAi,
      openDroppedPath,
    });

    expect(target.dropExplorerPath("/repo/app.ts", 20, 1)).toBe(true);
    expect(paste).toHaveBeenCalledWith(4, "/repo/app.ts ");

    expect(target.dropExplorerPath("/repo/app.ts", 50, 1)).toBe(true);
    expect(attachToAi).toHaveBeenCalledWith("/repo/app.ts");

    expect(target.dropExplorerPath("/repo/app.ts", 100, 1)).toBe(false);
    expect(openDroppedPath).not.toHaveBeenCalled();
  });

  it("delegates to openDroppedPath when dropped outside any terminal or AI chat", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const openDroppedPath = vi.fn(() => true);
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => null,
      paste,
      setTarget,
      isAiChatAtPoint: () => false,
      openDroppedPath,
    });

    expect(target.dropPath("/repo/dropped-folder", 100, 100)).toBe(true);
    expect(openDroppedPath).toHaveBeenCalledWith("/repo/dropped-folder");
    expect(paste).not.toHaveBeenCalled();
  });

  it("yields and returns false when dropped on explorer area", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const openDroppedPath = vi.fn(() => true);

    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => null,
      paste,
      setTarget,
      isAiChatAtPoint: () => false,
      isExplorerAtPoint: (x) => x < 200,
      openDroppedPath,
    });

    expect(target.updateTarget(50, 50)).toBe(true);
    expect(setTarget).toHaveBeenCalledWith(null);

    expect(target.dropPath("/repo/file.txt", 50, 50)).toBe(false);
    expect(openDroppedPath).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });
});
