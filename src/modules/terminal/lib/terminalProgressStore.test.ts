import { beforeEach, describe, expect, it } from "vitest";
import {
  extractProgressFromText,
  parseOsc9Progress,
  PROGRESS_SCAN_TAIL_CHARS,
  useTerminalProgressStore,
} from "./terminalProgressStore";

describe("extractProgressFromText", () => {
  it("extracts step fractions [current/total]", () => {
    expect(extractProgressFromText("[12/48] Building C object")).toBe(25);
    expect(extractProgressFromText("(3/10) Downloading...")).toBe(30);
    expect(extractProgressFromText("[50/50] Compiling")).toBe(100);
  });

  it("extracts percentages correctly", () => {
    expect(extractProgressFromText("Progress: 45%")).toBe(45);
    expect(extractProgressFromText("[  78% ] Linking...")).toBe(78);
    expect(extractProgressFromText("Downloading package (45.2 MB) 92%")).toBe(
      92,
    );
  });

  it("returns null on non-progress text", () => {
    expect(extractProgressFromText("npm run build")).toBeNull();
    expect(extractProgressFromText("error: failed to compile")).toBeNull();
    expect(extractProgressFromText("")).toBeNull();
  });

  it("uses the last percentage when a chunk carries many", () => {
    const line = Array.from({ length: 100 }, (_, i) => `step ${i}%`).join("\n");
    expect(extractProgressFromText(line)).toBe(99);
  });
});

describe("processPtyOutput scan bound", () => {
  beforeEach(() => {
    useTerminalProgressStore.setState({ leaves: {} });
  });

  it("still finds progress at the end of an oversized chunk", () => {
    const store = useTerminalProgressStore.getState();
    store.setLeafCommandStart(7);
    const noise = "x".repeat(PROGRESS_SCAN_TAIL_CHARS * 3);
    store.processPtyOutput(7, `${noise}\nBuilding 42%`);
    expect(useTerminalProgressStore.getState().leaves[7]?.progress).toBe(42);
  });

  it("ignores progress buried beyond the scanned tail", () => {
    const store = useTerminalProgressStore.getState();
    store.setLeafCommandStart(8);
    const noise = "x".repeat(PROGRESS_SCAN_TAIL_CHARS * 3);
    store.processPtyOutput(8, `Building 42%\n${noise}`);
    // Bounded on purpose: a stale marker megabytes back is not the value a
    // progress indicator should report, and scanning for it costs the frame.
    // progress stays at its command-start value of null.
    expect(useTerminalProgressStore.getState().leaves[8]?.progress).toBeNull();
  });
});

describe("parseOsc9Progress", () => {
  it("parses normal progress (state 1)", () => {
    expect(parseOsc9Progress("4;1;65")).toEqual({
      state: "normal",
      progress: 65,
    });
  });

  it("parses completed / none (state 0)", () => {
    expect(parseOsc9Progress("4;0;0")).toEqual({
      state: "none",
      progress: 100,
    });
  });

  it("parses indeterminate (state 3)", () => {
    expect(parseOsc9Progress("4;3")).toEqual({
      state: "indeterminate",
      progress: null,
    });
  });

  it("parses error state (state 2)", () => {
    expect(parseOsc9Progress("4;2;80")).toEqual({
      state: "error",
      progress: 80,
    });
  });
});

describe("useTerminalProgressStore", () => {
  beforeEach(() => {
    useTerminalProgressStore.setState({ leaves: {} });
  });

  it("tracks start, progress and completion", () => {
    const store = useTerminalProgressStore.getState();
    store.setLeafCommandStart(1, "pnpm tauri build");

    let info = useTerminalProgressStore.getState().leaves[1];
    expect(info?.state).toBe("running");
    expect(info?.progress).toBeNull();
    expect(info?.command).toBe("pnpm tauri build");

    store.setLeafProgress(1, 45);
    info = useTerminalProgressStore.getState().leaves[1];
    expect(info?.progress).toBe(45);

    store.setLeafCommandEnd(1, 0);
    info = useTerminalProgressStore.getState().leaves[1];
    expect(info?.state).toBe("completed");
    expect(info?.progress).toBe(100);
    expect(info?.exitCode).toBe(0);
  });

  it("tracks failed command exit", () => {
    const store = useTerminalProgressStore.getState();
    store.setLeafCommandStart(2, "npm test");
    store.setLeafCommandEnd(2, 1);

    const info = useTerminalProgressStore.getState().leaves[2];
    expect(info?.state).toBe("failed");
    expect(info?.exitCode).toBe(1);
  });
});
