import { describe, expect, it, vi } from "vitest";
import {
  notifyLeafScroll,
  subscribeLeafScroll,
  getLeafScrollInfo,
} from "./lib/useTerminalSession";

describe("TerminalScrollBottomHud & scroll tracking", () => {
  it("allows subscription and notification of scroll events for a leaf", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeLeafScroll(100, callback);

    notifyLeafScroll(100);
    expect(callback).toHaveBeenCalledTimes(1);

    notifyLeafScroll(200);
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyLeafScroll(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("returns default not scrolled info when no slot exists", () => {
    const info = getLeafScrollInfo(99999);
    expect(info).toEqual({
      isScrolledUp: false,
      linesAbove: 0,
      snippet: "",
    });
  });
});
