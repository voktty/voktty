import { describe, expect, it, vi, beforeEach } from "vitest";
import { useCommandHistoryStore } from "./commandHistoryStore";

vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  captureTerminalInputTarget: vi.fn((leafId?: number | null) =>
    leafId === null ? null : { leafId: leafId ?? 42 },
  ),
}));

describe("commandHistoryStore", () => {
  beforeEach(() => {
    useCommandHistoryStore.setState({
      isOpen: false,
      targetLeafId: null,
      inputTarget: null,
      searchQuery: "",
      shellFilter: "all",
      scrollPosition: 0,
      modalPosition: null,
    });
  });

  it("opens history and captures active terminal leaf", () => {
    useCommandHistoryStore.getState().openHistory("git status");
    const state = useCommandHistoryStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.searchQuery).toBe("git status");
    expect(state.targetLeafId).toBe(42);
  });

  it("opens history with explicit targetLeafId", () => {
    useCommandHistoryStore.getState().openHistory("ls", 101);
    const state = useCommandHistoryStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.searchQuery).toBe("ls");
    expect(state.targetLeafId).toBe(101);
  });

  it("closes history and resets targetLeafId", () => {
    useCommandHistoryStore.getState().openHistory("ls", 101);
    useCommandHistoryStore.getState().closeHistory();
    const state = useCommandHistoryStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.targetLeafId).toBeNull();
    expect(state.inputTarget).toBeNull();
  });

  it("toggles history with explicit targetLeafId", () => {
    useCommandHistoryStore.getState().toggleHistory(99);
    expect(useCommandHistoryStore.getState().isOpen).toBe(true);
    expect(useCommandHistoryStore.getState().targetLeafId).toBe(99);

    useCommandHistoryStore.getState().toggleHistory();
    expect(useCommandHistoryStore.getState().isOpen).toBe(false);
    expect(useCommandHistoryStore.getState().targetLeafId).toBeNull();
  });

  it("keeps an explicit missing target read-only instead of capturing another leaf", () => {
    useCommandHistoryStore.getState().openHistory("ls", null);
    expect(useCommandHistoryStore.getState().targetLeafId).toBeNull();
    expect(useCommandHistoryStore.getState().inputTarget).toBeNull();
  });
});
