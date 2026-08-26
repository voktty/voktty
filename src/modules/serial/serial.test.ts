import {
  type CommandPaletteActionContext,
  createCommandItems,
} from "@/modules/command-palette/commands";
import { workspaceScopeKey } from "@/modules/workspace";
import { describe, expect, it, vi } from "vitest";
import { listSerialPorts, setSerialSignals } from "./serialApi";
import { COMMON_BAUD_RATES } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

describe("Serial Module Tests", () => {
  it("generates correct workspaceScopeKey for serial connections", () => {
    const scopeKey = workspaceScopeKey({
      kind: "serial",
      portName: "COM3",
      baudRate: 115200,
    });
    expect(scopeKey).toBe("serial:COM3:115200");
  });

  it("includes common baud rates in constant array", () => {
    expect(COMMON_BAUD_RATES).toContain(9600);
    expect(COMMON_BAUD_RATES).toContain(115200);
    expect(COMMON_BAUD_RATES).toContain(921600);
  });

  it("calls serial_list_ports via listSerialPorts", async () => {
    const mockPorts = [
      { port_name: "COM3", port_type: "USB", product: "CP2102" },
      { port_name: "/dev/ttyUSB0", port_type: "USB", manufacturer: "FTDI" },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(mockPorts);

    const result = await listSerialPorts();
    expect(invoke).toHaveBeenCalledWith("serial_list_ports");
    expect(result).toEqual(mockPorts);
  });

  it("calls serial_set_signals via setSerialSignals", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await setSerialSignals(42, { dtr: true, rts: false });
    expect(invoke).toHaveBeenCalledWith("serial_set_signals", {
      id: 42,
      signals: { dtr: true, rts: false },
    });
  });

  it("registers tab.serialConnect command and invokes callback", () => {
    const openSerialConnect = vi.fn();
    const ctx: CommandPaletteActionContext = {
      tabs: [],
      activeId: 0,
      searchTarget: "content" as never,
      explorerRoot: null,
      home: null,
      openNewTab: vi.fn(),
      openNewBlock: vi.fn(),
      openNewPrivate: vi.fn(),
      openSerialConnect,
      openNewEditor: vi.fn(),
      openQuickOpen: vi.fn(),
      openWorkspaceSearch: vi.fn(),
      openOutline: vi.fn(),
      openProblems: vi.fn(),
      navigateBack: vi.fn(),
      navigateForward: vi.fn(),
      canNavigateBack: false,
      canNavigateForward: false,
      openNewPreview: vi.fn(),
      openActiveTabs: vi.fn(),
      openGitGraph: vi.fn(),
      toggleSourceControl: vi.fn(),
      closeActiveTabOrPane: vi.fn(),
      splitPaneRight: vi.fn(),
      splitPaneDown: vi.fn(),
      focusSearch: vi.fn(),
      focusExplorerSearch: vi.fn(),
      toggleSidebar: vi.fn(),
      toggleHiddenFiles: vi.fn(),
      toggleAi: vi.fn(),
      askAiSelection: vi.fn(),
      openSettings: vi.fn(),
      openKeyboardShortcuts: vi.fn(),
      spaces: [],
      activeSpaceId: null,
      openSpacesOverview: vi.fn(),
      newSpace: vi.fn(),
      switchSpace: vi.fn(),
      editorActions: null,
    };

    const items = createCommandItems(ctx);
    const serialCmd = items.find((i) => i.id === "tab.serialConnect");
    expect(serialCmd).toBeDefined();
    expect(serialCmd?.title).toBeDefined();

    serialCmd?.run();
    expect(openSerialConnect).toHaveBeenCalledTimes(1);
  });
});
