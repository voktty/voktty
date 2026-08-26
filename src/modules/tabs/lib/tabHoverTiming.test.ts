import { describe, expect, it } from "vitest";
import { TAB_DETAILS_OPEN_DELAY_MS } from "./tabHoverTiming";

describe("tab hover timing", () => {
  it("waits long enough to behave as an intentional inspection", () => {
    expect(TAB_DETAILS_OPEN_DELAY_MS).toBeGreaterThanOrEqual(1_500);
  });
});
