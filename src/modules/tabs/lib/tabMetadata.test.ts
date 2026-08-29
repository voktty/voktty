import { describe, expect, it } from "vitest";
import {
  formatUptime,
  getTabPath,
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

  it("extracts path from path, repoRoot, and cwd properties", () => {
    expect(getTabPath({ path: "C:/foo/bar.ts" })).toBe("C:/foo/bar.ts");
    expect(getTabPath({ repoRoot: "/workspace/repo" })).toBe("/workspace/repo");
    expect(getTabPath({ cwd: "D:/project" })).toBe("D:/project");
    expect(getTabPath({})).toBeNull();
    expect(getTabPath(null)).toBeNull();
  });
});
