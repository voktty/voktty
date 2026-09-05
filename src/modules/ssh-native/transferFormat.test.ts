import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatSize,
  formatSpeed,
  percentDone,
  sizeOf,
} from "./transferFormat";

describe("sizeOf", () => {
  it("keeps small numbers in bytes", () => {
    expect(sizeOf(512)).toEqual({ value: 512, unit: "B" });
  });

  it("climbs a unit at each multiple of 1024", () => {
    expect(sizeOf(1024).unit).toBe("KB");
    expect(sizeOf(1024 ** 2).unit).toBe("MB");
    expect(sizeOf(1024 ** 3).unit).toBe("GB");
    expect(sizeOf(1024 ** 4).unit).toBe("TB");
  });

  it("stops at the largest unit instead of running off the list", () => {
    expect(sizeOf(1024 ** 6).unit).toBe("TB");
  });

  it("treats nothing and nonsense as zero bytes", () => {
    for (const input of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sizeOf(input)).toEqual({ value: 0, unit: "B" });
    }
  });
});

describe("formatSize", () => {
  it("shows bytes whole and larger units with one decimal", () => {
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 ** 2 * 2.25)).toBe("2.3 MB");
  });

  it("never reads as zero while something is moving", () => {
    // One byte over a megabyte must not round down to 0.0.
    expect(formatSize(1024 ** 2 + 1)).toBe("1.0 MB");
    expect(formatSize(1)).toBe("1 B");
  });
});

describe("formatSpeed", () => {
  it("appends a rate to the size", () => {
    expect(formatSpeed(1536)).toBe("1.5 KB/s");
  });

  it("reports nothing when the speed is unknown or stalled", () => {
    expect(formatSpeed(undefined)).toBeUndefined();
    expect(formatSpeed(0)).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("uses seconds under a minute", () => {
    expect(formatDuration(5)).toBe("5s");
    expect(formatDuration(59)).toBe("59s");
  });

  it("never shows zero seconds while work is left", () => {
    expect(formatDuration(0.2)).toBe("1s");
  });

  it("uses minutes under an hour", () => {
    expect(formatDuration(90)).toBe("2m");
    expect(formatDuration(3599)).toBe("60m");
  });

  it("uses hours and minutes past an hour", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3600 + 1800)).toBe("1h 30m");
  });

  it("reports nothing for an unknown or impossible duration", () => {
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(-1)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
  });
});

describe("percentDone", () => {
  it("reports the ratio as a whole number", () => {
    expect(percentDone(50, 200)).toBe(25);
    expect(percentDone(1, 3)).toBe(33);
  });

  it("treats a job with nothing to move as complete", () => {
    // A folder of empty files still finished.
    expect(percentDone(0, 0)).toBe(100);
  });

  it("clamps beyond the ends rather than reporting past 100", () => {
    expect(percentDone(300, 200)).toBe(100);
    expect(percentDone(-5, 200)).toBe(0);
  });
});
