import { beforeEach, describe, expect, it } from "vitest";
import {
  formatConsoleErrorPrompt,
  usePreviewDevtoolsStore,
} from "./previewDevtoolsStore";

describe("previewDevtoolsStore", () => {
  beforeEach(() => {
    usePreviewDevtoolsStore.getState().resetViewport();
    usePreviewDevtoolsStore.getState().clearConsole();
  });

  it("handles viewport preset selection", () => {
    expect(usePreviewDevtoolsStore.getState().viewportMode).toBe("responsive");

    usePreviewDevtoolsStore.getState().selectPreset("iphone-16-pro");
    const state = usePreviewDevtoolsStore.getState();
    expect(state.viewportMode).toBe("mobile");
    expect(state.activePresetId).toBe("iphone-16-pro");
    expect(state.customWidth).toBe(393);
    expect(state.customHeight).toBe(852);
    expect(state.isLandscape).toBe(false);
  });

  it("toggles landscape orientation", () => {
    usePreviewDevtoolsStore.getState().selectPreset("iphone-16-pro");
    expect(usePreviewDevtoolsStore.getState().customWidth).toBe(393);
    expect(usePreviewDevtoolsStore.getState().customHeight).toBe(852);

    usePreviewDevtoolsStore.getState().toggleLandscape();
    expect(usePreviewDevtoolsStore.getState().isLandscape).toBe(true);
    expect(usePreviewDevtoolsStore.getState().customWidth).toBe(852);
    expect(usePreviewDevtoolsStore.getState().customHeight).toBe(393);
  });

  it("adds and groups identical consecutive console entries", () => {
    usePreviewDevtoolsStore.getState().addConsoleEntry({
      id: "1",
      level: "error",
      message: "Uncaught TypeError: Cannot read properties of undefined",
      timestamp: 1000,
    });

    expect(usePreviewDevtoolsStore.getState().consoleEntries).toHaveLength(1);
    expect(usePreviewDevtoolsStore.getState().consoleEntries[0].count).toBe(1);

    // Identical error arrives
    usePreviewDevtoolsStore.getState().addConsoleEntry({
      id: "2",
      level: "error",
      message: "Uncaught TypeError: Cannot read properties of undefined",
      timestamp: 2000,
    });

    expect(usePreviewDevtoolsStore.getState().consoleEntries).toHaveLength(1);
    expect(usePreviewDevtoolsStore.getState().consoleEntries[0].count).toBe(2);

    // Different message arrives
    usePreviewDevtoolsStore.getState().addConsoleEntry({
      id: "3",
      level: "warn",
      message: "React key warning",
      timestamp: 3000,
    });

    expect(usePreviewDevtoolsStore.getState().consoleEntries).toHaveLength(2);
  });

  it("formats console error prompt with actionable context", () => {
    const prompt = formatConsoleErrorPrompt({
      id: "err-1",
      level: "error",
      message: "Failed to fetch /api/users",
      stack: "Error: Failed to fetch\n  at UserService.ts:15:7",
      source: { file: "src/services/UserService.ts", line: 15, column: 7 },
      timestamp: Date.now(),
      count: 1,
    });

    expect(prompt).toContain("### 🐛 Solicitud de Solución de Error en Consola");
    expect(prompt).toContain("Failed to fetch /api/users");
    expect(prompt).toContain("UserService.ts:15");
    expect(prompt).toContain("Stack Trace");
  });
});
