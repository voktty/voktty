import { describe, expect, it, beforeEach } from "vitest";
import {
  isAnyContextMenuOpen,
  useTabContextMenuStore,
} from "./tabContextMenuState";

describe("tabContextMenuState", () => {
  beforeEach(() => {
    useTabContextMenuStore.setState({ isOpen: false });
  });

  it("updates isOpen when setOpen is called", () => {
    expect(useTabContextMenuStore.getState().isOpen).toBe(false);
    expect(isAnyContextMenuOpen()).toBe(false);

    useTabContextMenuStore.getState().setOpen(true);
    expect(useTabContextMenuStore.getState().isOpen).toBe(true);
    expect(isAnyContextMenuOpen()).toBe(true);

    useTabContextMenuStore.getState().setOpen(false);
    expect(useTabContextMenuStore.getState().isOpen).toBe(false);
    expect(isAnyContextMenuOpen()).toBe(false);
  });
});
