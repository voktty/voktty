import { describe, expect, it, vi } from "vitest";
import {
  registerHarnessTerminalAdoption,
  requestHarnessTerminalAdoption,
} from "@/modules/surfaces/lib/harnessTerminalAdoption";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

const terminal = {
  tabKey: asTabKey("term"),
  cwd: "/work",
  assignProject: () => "/work",
};

describe("Harness terminal adoption", () => {
  it("only reaches the Harness the terminal was dropped on", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const offFirst = registerHarnessTerminalAdoption(asTabKey("one"), first);
    const offSecond = registerHarnessTerminalAdoption(asTabKey("two"), second);
    expect(requestHarnessTerminalAdoption(asTabKey("two"), terminal)).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(terminal);
    offFirst();
    offSecond();
  });

  it("answers false when the Harness is gone or refuses", () => {
    expect(requestHarnessTerminalAdoption(asTabKey("missing"), terminal)).toBe(
      false,
    );
    const off = registerHarnessTerminalAdoption(asTabKey("h"), () => {
      throw new Error("view retired");
    });
    expect(requestHarnessTerminalAdoption(asTabKey("h"), terminal)).toBe(false);
    off();
  });

  it("does not let a stale registration remove its successor", () => {
    const stale = registerHarnessTerminalAdoption(asTabKey("h"), () => false);
    const current = vi.fn(() => true);
    const off = registerHarnessTerminalAdoption(asTabKey("h"), current);
    stale();
    expect(requestHarnessTerminalAdoption(asTabKey("h"), terminal)).toBe(true);
    off();
  });
});
