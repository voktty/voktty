import { describe, expect, it } from "vitest";
import { useSlotTints, WINDOW_TINT_PRESETS } from "./slotTints";

describe("slotTints", () => {
  it("sets, gets and resets window tint presets", () => {
    const store = useSlotTints.getState();
    store.setTint("space-1:slot-a", "blue");
    expect(useSlotTints.getState().getTint("space-1", "slot-a")?.id).toBe("blue");

    store.setTint("space-1:slot-a", null);
    expect(useSlotTints.getState().getTint("space-1", "slot-a")).toBeNull();
  });

  it("contains all 8 distinct presets", () => {
    expect(WINDOW_TINT_PRESETS.length).toBe(8);
  });
});
