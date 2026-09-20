import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleEditorFindKey,
  openFindInActiveEditor,
  registerEditorSearchHandlers,
  resetEditorSearchHandlers,
} from "./editorSearchBridge";

afterEach(() => {
  resetEditorSearchHandlers();
});

const keyEvent = () => ({ key: "f" }) as unknown as KeyboardEvent;

describe("editor search bridge", () => {
  it("declines while no editor surface has been loaded", () => {
    // Not a dropped keystroke: the real handlers resolve the active editor
    // from the DOM and answer false when there is none, and the only surface
    // that mounts one is what loads them.
    expect(handleEditorFindKey(keyEvent())).toBe(false);
    expect(openFindInActiveEditor()).toBe(false);
  });

  it("forwards to the handlers once the editor surface registers them", () => {
    const handleEditorFindKeyImpl = vi.fn().mockReturnValue(true);
    const openFindInActiveEditorImpl = vi.fn().mockReturnValue(true);
    registerEditorSearchHandlers({
      handleEditorFindKey: handleEditorFindKeyImpl,
      openFindInActiveEditor: openFindInActiveEditorImpl,
    });

    const event = keyEvent();
    expect(handleEditorFindKey(event)).toBe(true);
    expect(handleEditorFindKeyImpl).toHaveBeenCalledWith(event);
    expect(openFindInActiveEditor()).toBe(true);
    expect(openFindInActiveEditorImpl).toHaveBeenCalledOnce();
  });

  it("passes a declining answer through rather than forcing true", () => {
    registerEditorSearchHandlers({
      handleEditorFindKey: () => false,
      openFindInActiveEditor: () => false,
    });
    expect(handleEditorFindKey(keyEvent())).toBe(false);
    expect(openFindInActiveEditor()).toBe(false);
  });

  it("keeps the latest registration", () => {
    registerEditorSearchHandlers({
      handleEditorFindKey: () => false,
      openFindInActiveEditor: () => false,
    });
    registerEditorSearchHandlers({
      handleEditorFindKey: () => true,
      openFindInActiveEditor: () => true,
    });
    expect(handleEditorFindKey(keyEvent())).toBe(true);
  });
});
