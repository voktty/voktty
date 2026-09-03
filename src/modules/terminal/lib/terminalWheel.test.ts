import { describe, expect, it, beforeEach } from "vitest";
import {
  handleTerminalWheel,
  configureRendererPool,
  type Slot,
} from "./rendererPool";

describe("handleTerminalWheel", () => {
  let writtenData: string[] = [];
  let isRemoteSession = false;
  let isMultiplexerTmux = false;

  beforeEach(() => {
    writtenData = [];
    isRemoteSession = false;
    isMultiplexerTmux = false;

    configureRendererPool({
      resolveLeaf: (_leafId) => ({
        writeToPty: (data) => writtenData.push(data),
        resizePty: () => {},
        kickPty: () => {},
      }),
      evictLeaf: () => {},
      isLeafFocused: () => true,
      isLeafBlocks: () => false,
      isLeafBusy: () => false,
      isLeafVisible: () => true,
      storeSnapshot: () => {},
      getSessionInfo: (_leafId) => ({
        workspaceEnv: isRemoteSession
          ? {
              kind: "ssh" as const,
              root: "/home/ubuntu",
              connection: {
                id: "test",
                name: "test",
                host: "remote.host",
                multiplexerMode: isMultiplexerTmux ? "tmux" : "none",
              },
            }
          : { kind: "local" as const },
        cwd: null,
        isUnix: true,
      }),
    });
  });

  function mockWheelEvent(init: {
    deltaY?: number;
    altKey?: boolean;
    clientY?: number;
  }): WheelEvent {
    return {
      deltaY: init.deltaY ?? 0,
      altKey: init.altKey ?? false,
      clientY: init.clientY ?? 0,
      preventDefault: () => {},
    } as unknown as WheelEvent;
  }

  function mockSlot(
    bufferType: "normal" | "alternate",
    mouseMode: string = "none",
    cursorY: number = 20,
  ): Slot {
    return {
      id: 1,
      currentLeafId: 42,
      retainedLeafId: null,
      fixedGrid: false,
      parked: false,
      oscDisposers: [],
      observer: null,
      fitTimer: null,
      ptyTimer: null,
      webglReapTimer: null,
      slotReapTimer: null,
      unhideRaf: null,
      resizeRaf: null,
      lastCols: 80,
      lastRows: 24,
      lastW: 800,
      lastH: 600,
      lastUsedAt: 100,
      selectionCopyTimer: null,
      isDirectTyping: false,
      wheelHistoryAccumulator: 0,
      webglAddon: null,
      webglCanvases: [],
      fitAddon: {} as any,
      searchAddon: {} as any,
      serializeAddon: {} as any,
      imeState: {} as any,
      host: {
        getBoundingClientRect: () => ({
          top: 0,
          left: 0,
          width: 800,
          height: 600,
          bottom: 600,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => {},
        }),
      } as unknown as HTMLDivElement,
      term: {
        rows: 24,
        cols: 80,
        buffer: {
          active: {
            type: bufferType,
            cursorY,
            cursorX: 5,
            baseY: 0,
          },
        },
        modes: {
          mouseTrackingMode: mouseMode,
        },
      } as any,
    };
  }

  it("passes normal buffer scroll to xterm native handling", () => {
    const slot = mockSlot("normal");
    const event = mockWheelEvent({ deltaY: -100 });
    const result = handleTerminalWheel(slot, event);
    expect(result).toBe(true);
    expect(writtenData).toHaveLength(0);
  });

  it("passes mouse-tracking sessions to xterm native mouse reporting", () => {
    const slot = mockSlot("alternate", "any");
    const event = mockWheelEvent({ deltaY: -100 });
    const result = handleTerminalWheel(slot, event);
    expect(result).toBe(true);
    expect(writtenData).toHaveLength(0);
  });

  it("navigates history with throttled Up arrows when holding Alt in alternate buffer", () => {
    const slot = mockSlot("alternate", "none");
    const event = mockWheelEvent({ deltaY: -50, altKey: true });
    const result = handleTerminalWheel(slot, event);

    expect(result).toBe(false);
    expect(writtenData).toEqual(["\x1b[A"]);
  });

  it("navigates history with Down arrow when scrolling down with Alt in alternate buffer", () => {
    const slot = mockSlot("alternate", "none");
    const event = mockWheelEvent({ deltaY: 50, altKey: true });
    const result = handleTerminalWheel(slot, event);

    expect(result).toBe(false);
    expect(writtenData).toEqual(["\x1b[B"]);
  });

  it("navigates history when scrolling directly over the prompt input line", () => {
    const slot = mockSlot("alternate", "none", 20);
    const event = mockWheelEvent({ clientY: 520, deltaY: -50 });
    const result = handleTerminalWheel(slot, event);

    expect(result).toBe(false);
    expect(writtenData).toEqual(["\x1b[A"]);
  });

  it("sends tmux copy-mode sequence on scroll up over chat view in remote SSH session", () => {
    isRemoteSession = true;
    const slot = mockSlot("alternate", "none", 20);
    const event = mockWheelEvent({ clientY: 200, deltaY: -50 });
    const result = handleTerminalWheel(slot, event);

    expect(result).toBe(false);
    expect(writtenData).toEqual(["\x02[\x1b[5~"]);
  });

  it("sends page down in copy-mode on scroll down over chat view in remote SSH session", () => {
    isRemoteSession = true;
    const slot = mockSlot("alternate", "none", 20);
    const event = mockWheelEvent({ clientY: 200, deltaY: 50 });
    const result = handleTerminalWheel(slot, event);

    expect(result).toBe(false);
    expect(writtenData).toEqual(["\x1b[6~"]);
  });

  it("suppresses accidental arrow keys over chat view in local alternate buffer", () => {
    isRemoteSession = false;
    const slot = mockSlot("alternate", "none", 20);
    const event = mockWheelEvent({ clientY: 200, deltaY: -50 });
    const result = handleTerminalWheel(slot, event);

    expect(result).toBe(false);
    expect(writtenData).toHaveLength(0);
  });
});
