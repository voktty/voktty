import { describe, expect, it } from "vitest";
import {
  formatUptime,
  getTabUptimeMs,
  recordTabCreation,
  removeTabCreation,
} from "./tabMetadata";

describe("tabMetadata & formatUptime", () => {
  it("formats uptime seconds, minutes, hours and days correctly", () => {
    expect(formatUptime(5000)).toBe("5s");
    expect(formatUptime(65000)).toBe("1m 05s");
    expect(formatUptime(3665000)).toBe("1h 01m");
    expect(formatUptime(90000000)).toBe("1d 1h");
  });

  it("records and tracks creation time for tabs", () => {
    const tabId = 999123;
    const now = Date.now() - 10000;
    recordTabCreation(tabId, now);

    const uptime = getTabUptimeMs(tabId);
    expect(uptime).toBeGreaterThanOrEqual(10000);

    removeTabCreation(tabId);
  });
});
