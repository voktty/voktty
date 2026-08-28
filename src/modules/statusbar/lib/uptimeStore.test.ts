import { describe, expect, it, beforeEach } from "vitest";
import {
  formatHoursDecimal,
  getSessionDurationFormatted,
  getSessionHours,
  getTopActivePaths,
  getUptimeColorLevel,
  getWeeklyBreakdown,
  useUptimeStore,
} from "./uptimeStore";

describe("uptimeStore", () => {
  beforeEach(() => {
    useUptimeStore.setState({
      sessionStart: Date.now(),
      history: {},
    });
  });

  it("calculates session hours correctly", () => {
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000 - 5000;
    expect(getSessionHours(twoHoursAgo)).toBe(2);
  });

  it("formats session duration", () => {
    const oneHourThirtyMinAgo = Date.now() - (1 * 3600 + 30 * 60) * 1000;
    expect(getSessionDurationFormatted(oneHourThirtyMinAgo)).toBe("1h 30m");
  });

  it("determines correct color level based on hours", () => {
    expect(getUptimeColorLevel(0).level).toBe("emerald");
    expect(getUptimeColorLevel(1).level).toBe("emerald");
    expect(getUptimeColorLevel(3).level).toBe("cyan");
    expect(getUptimeColorLevel(6).level).toBe("amber");
    expect(getUptimeColorLevel(9).level).toBe("orange");
    expect(getUptimeColorLevel(14).level).toBe("rose");
  });

  it("formats decimal hours accurately", () => {
    expect(formatHoursDecimal(1800)).toBe("0.5h");
    expect(formatHoursDecimal(7200)).toBe("2.0h");
  });

  it("records tick and updates today seconds and active path", () => {
    useUptimeStore.getState().tick("C:/proyectos/terax-ai", 10);
    useUptimeStore.getState().tick("C:/proyectos/terax-ai", 20);

    const history = useUptimeStore.getState().history;
    const todayKey = Object.keys(history)[0];
    expect(todayKey).toBeDefined();
    expect(history[todayKey].seconds).toBe(30);
    expect(history[todayKey].paths["C:/proyectos/terax-ai"]).toBe(30);
  });

  it("generates weekly breakdown", () => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const history = {
      [todayKey]: {
        seconds: 7200,
        paths: { "C:/proyectos/terax-ai": 7200 },
      },
    };

    const breakdown = getWeeklyBreakdown(history);
    expect(breakdown.days).toHaveLength(7);
    expect(breakdown.totalWeekSeconds).toBe(7200);
    expect(breakdown.todaySeconds).toBe(7200);
    expect(breakdown.days[breakdown.days.length - 1].isToday).toBe(true);
  });

  it("aggregates top active paths", () => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const history = {
      [todayKey]: {
        seconds: 10000,
        paths: {
          "C:/proyectos/terax-ai": 7000,
          "C:/proyectos/docs": 3000,
        },
      },
    };

    const top = getTopActivePaths(history);
    expect(top).toHaveLength(2);
    expect(top[0].name).toBe("terax-ai");
    expect(top[0].percentage).toBe(70);
    expect(top[1].name).toBe("docs");
    expect(top[1].percentage).toBe(30);
  });
});
