import { describe, expect, it } from "vitest";
import { markFirstTerminalReady, markStartupPhase } from "./startupTiming";

describe("startup timing", () => {
  it("records phase names without application content", () => {
    performance.clearMarks();
    markStartupPhase("js-start");
    markFirstTerminalReady();
    markFirstTerminalReady();

    expect(performance.getEntriesByName("voktty:start:js-start")).toHaveLength(
      1,
    );
    expect(
      performance.getEntriesByName("voktty:start:terminal-ready"),
    ).toHaveLength(1);
  });
});
