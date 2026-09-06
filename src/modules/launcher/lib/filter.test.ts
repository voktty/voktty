import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LauncherItem } from "../types";
import { filterLauncherItems, groupLauncherItems } from "./filter";

const noop = () => {};
const icon = [] as unknown as LauncherItem["icon"];

function item(
  id: string,
  title: string,
  group: LauncherItem["group"],
  keywords: string[] = [],
): LauncherItem {
  return { id, title, group, keywords, icon, run: noop };
}

const ITEMS: LauncherItem[] = [
  item("launch.terminal", "Terminal", "terminals", ["shell", "consola"]),
  item("launch.gitGraph", "Git graph", "git", ["commits", "grafo"]),
  item("launch.arcade", "Arcade", "extras", ["game", "juego", "pacman"]),
  item("launch.settings", "Settings", "system", ["ajustes"]),
];

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filterLauncherItems", () => {
  it("keeps everything when there is no query", () => {
    expect(filterLauncherItems(ITEMS, "").length).toBe(ITEMS.length);
    expect(filterLauncherItems(ITEMS, "   ").length).toBe(ITEMS.length);
  });

  it("orders an empty query by group so the grid is stable", () => {
    const ids = filterLauncherItems(ITEMS, "").map((i) => i.id);
    expect(ids).toEqual([
      "launch.terminal",
      "launch.gitGraph",
      "launch.settings",
      "launch.arcade",
    ]);
  });

  it("matches on the title", () => {
    const ids = filterLauncherItems(ITEMS, "term").map((i) => i.id);
    expect(ids).toContain("launch.terminal");
    expect(ids).not.toContain("launch.arcade");
  });

  it("matches on a Spanish keyword", () => {
    // The launcher is typed into, and people reach for either language.
    const ids = filterLauncherItems(ITEMS, "juego").map((i) => i.id);
    expect(ids).toEqual(["launch.arcade"]);
  });

  it("drops items that match nothing", () => {
    expect(filterLauncherItems(ITEMS, "zzzz")).toEqual([]);
  });

  it("ranks by match quality before recency", () => {
    store["voktty-palette-mru"] = JSON.stringify({
      "launch.terminal": Date.now(),
    });
    // "grafo" is a keyword of Git graph and matches far better than anything
    // Terminal offers, so being the most recently used does not save Terminal.
    expect(filterLauncherItems(ITEMS, "grafo")[0].id).toBe("launch.gitGraph");
  });

  it("lets recency break a tie between equally good matches", () => {
    const tied: LauncherItem[] = [
      item("launch.zetaOne", "Zeta one", "system", ["zz"]),
      item("launch.zetaTwo", "Zeta two", "system", ["zz"]),
    ];
    store["voktty-palette-mru"] = JSON.stringify({
      "launch.zetaTwo": Date.now(),
    });
    expect(filterLauncherItems(tied, "zz")[0].id).toBe("launch.zetaTwo");
  });

  it("surfaces the most recently used first when nothing is typed", () => {
    store["voktty-palette-mru"] = JSON.stringify({
      "launch.arcade": Date.now(),
    });
    expect(filterLauncherItems(ITEMS, "")[0].id).toBe("launch.arcade");
  });
});

describe("groupLauncherItems", () => {
  it("returns sections in catalog order, skipping empty groups", () => {
    const sections = groupLauncherItems(ITEMS);
    expect(sections.map((s) => s.group)).toEqual([
      "terminals",
      "git",
      "system",
      "extras",
    ]);
  });

  it("keeps every item in exactly one section", () => {
    const total = groupLauncherItems(ITEMS).reduce(
      (sum, s) => sum + s.items.length,
      0,
    );
    expect(total).toBe(ITEMS.length);
  });
});
