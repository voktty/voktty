import { beforeEach, describe, expect, it } from "vitest";
import { useNotesBoardStore } from "./notesBoardStore";

describe("notesBoardStore", () => {
  beforeEach(() => {
    useNotesBoardStore.setState({
      isOpen: false,
      activeTab: "notes",
      width: 640,
      height: 540,
    });
  });

  it("toggles open and close", () => {
    expect(useNotesBoardStore.getState().isOpen).toBe(false);
    useNotesBoardStore.getState().toggle();
    expect(useNotesBoardStore.getState().isOpen).toBe(true);
    useNotesBoardStore.getState().close();
    expect(useNotesBoardStore.getState().isOpen).toBe(false);
  });

  it("opens with specific tab", () => {
    useNotesBoardStore.getState().open("notes");
    expect(useNotesBoardStore.getState().isOpen).toBe(true);
    expect(useNotesBoardStore.getState().activeTab).toBe("notes");
  });

  it("changes tab", () => {
    useNotesBoardStore.getState().setTab("notes");
    expect(useNotesBoardStore.getState().activeTab).toBe("notes");
    useNotesBoardStore.getState().setTab("kanban");
    expect(useNotesBoardStore.getState().activeTab).toBe("kanban");
  });

  it("clamps size within valid ranges", () => {
    useNotesBoardStore.getState().setSize({ width: 200, height: 2000 });
    expect(useNotesBoardStore.getState().width).toBe(420); // clamped to min
    expect(useNotesBoardStore.getState().height).toBe(800); // clamped to max
  });
});
