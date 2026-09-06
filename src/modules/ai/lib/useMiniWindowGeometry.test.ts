import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_H, MIN_W } from "./miniWindowGeometry";
import {
  BADGE_STORE_KEY,
  getSavedGeom,
  loadBadgePos,
  loadGeom,
  STORE_KEY,
} from "./useMiniWindowGeometry";

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("window", {
    innerWidth: 1440,
    innerHeight: 900,
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadGeom", () => {
  it("reads a well formed entry", () => {
    store[STORE_KEY] = JSON.stringify({ x: 10, y: 20, w: 600, h: 500 });
    expect(loadGeom()).toEqual({ x: 10, y: 20, w: 600, h: 500 });
  });

  it("rejects an entry missing a field", () => {
    store[STORE_KEY] = JSON.stringify({ x: 10, y: 20, w: 600 });
    expect(loadGeom()).toBeNull();
  });

  it("rejects corrupt JSON", () => {
    store[STORE_KEY] = "{not json";
    expect(loadGeom()).toBeNull();
  });

  it("rejects a non finite coordinate", () => {
    // JSON.parse turns an overflowing literal into Infinity, which would
    // otherwise slip past every clamp and land in the style string.
    store[STORE_KEY] = '{"x":1e999,"y":20,"w":600,"h":500}';
    expect(loadGeom()).toBeNull();
  });
});

describe("getSavedGeom", () => {
  it("falls back to a default that fits the viewport", () => {
    const g = getSavedGeom();
    expect(g.w).toBeGreaterThanOrEqual(MIN_W);
    expect(g.h).toBeGreaterThanOrEqual(MIN_H);
    expect(g.x + g.w).toBeLessThanOrEqual(1440);
    expect(g.y + g.h).toBeLessThanOrEqual(900);
  });

  it("clamps a stored geometry larger than the viewport", () => {
    store[STORE_KEY] = JSON.stringify({ x: 2000, y: 2000, w: 4000, h: 4000 });
    const g = getSavedGeom();
    expect(g.w).toBe(1440);
    expect(g.h).toBe(900);
    expect(g.x).toBe(0);
    expect(g.y).toBe(0);
  });

  it("keeps a stored geometry that already fits", () => {
    store[STORE_KEY] = JSON.stringify({ x: 120, y: 60, w: 720, h: 640 });
    expect(getSavedGeom()).toEqual({ x: 120, y: 60, w: 720, h: 640 });
  });
});

describe("loadBadgePos", () => {
  it("rejects a non finite coordinate", () => {
    store[BADGE_STORE_KEY] = '{"x":1e999,"y":20}';
    expect(loadBadgePos()).toBeNull();
  });
});
