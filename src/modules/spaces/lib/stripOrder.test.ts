import { describe, expect, it } from "vitest";
import type { StripEntry } from "./spaceProjection";
import {
  entryGapFromItemGap,
  reorderStripEntries,
  spaceEntryId,
  standaloneEntryId,
  stripEntryId,
} from "./stripOrder";

const tab = (key: string): StripEntry =>
  ({ kind: "standalone", tabKey: key }) as StripEntry;
const space = (id: string): StripEntry =>
  ({ kind: "space", spaceId: id }) as StripEntry;

const ids = (entries: readonly StripEntry[]) => entries.map(stripEntryId);

describe("stripEntryId", () => {
  it("separates the two entry namespaces", () => {
    expect(stripEntryId(tab("a"))).not.toBe(stripEntryId(space("a")));
    expect(stripEntryId(tab("a"))).toBe(standaloneEntryId("a" as never));
    expect(stripEntryId(space("s1"))).toBe(spaceEntryId("s1" as never));
  });
});

describe("entryGapFromItemGap", () => {
  const owners = [
    standaloneEntryId("a" as never),
    spaceEntryId("s1" as never),
    spaceEntryId("s1" as never),
    spaceEntryId("s1" as never),
    standaloneEntryId("b" as never),
  ];

  it("maps the ends of the strip", () => {
    expect(entryGapFromItemGap(owners, 0)).toBe(0);
    expect(entryGapFromItemGap(owners, owners.length)).toBe(3);
  });

  it("maps a gap between two entries", () => {
    expect(entryGapFromItemGap(owners, 1)).toBe(1);
    expect(entryGapFromItemGap(owners, 4)).toBe(2);
  });

  it("resolves a gap inside an expanded space to its leading edge", () => {
    // Items 1..3 all belong to s1; dropping between two of its members must
    // not try to insert into the middle of the space.
    expect(entryGapFromItemGap(owners, 2)).toBe(1);
    expect(entryGapFromItemGap(owners, 3)).toBe(1);
  });

  it("clamps out-of-range gaps", () => {
    expect(entryGapFromItemGap(owners, -5)).toBe(0);
    expect(entryGapFromItemGap(owners, 99)).toBe(3);
  });

  it("handles an empty strip", () => {
    expect(entryGapFromItemGap([], 0)).toBe(0);
  });
});

describe("reorderStripEntries", () => {
  const entries = [tab("a"), space("s1"), tab("b"), space("s2")];

  it("moves a space, which the old standalone-only reorder could not", () => {
    const next = reorderStripEntries(entries, spaceEntryId("s2" as never), 0);
    expect(ids(next)).toEqual(
      ids([space("s2"), tab("a"), space("s1"), tab("b")]),
    );
  });

  it("moves a standalone tab past a space", () => {
    const next = reorderStripEntries(
      entries,
      standaloneEntryId("a" as never),
      3,
    );
    expect(ids(next)).toEqual(
      ids([space("s1"), tab("b"), tab("a"), space("s2")]),
    );
  });

  it("moves an entry to the end", () => {
    const next = reorderStripEntries(
      entries,
      standaloneEntryId("a" as never),
      4,
    );
    expect(ids(next)).toEqual(
      ids([space("s1"), tab("b"), space("s2"), tab("a")]),
    );
  });

  it("is a no-op when the entry does not move", () => {
    const next = reorderStripEntries(
      entries,
      standaloneEntryId("a" as never),
      0,
    );
    expect(ids(next)).toEqual(ids(entries));
    const alsoSame = reorderStripEntries(
      entries,
      standaloneEntryId("a" as never),
      1,
    );
    expect(ids(alsoSame)).toEqual(ids(entries));
  });

  it("ignores an unknown source instead of dropping entries", () => {
    const next = reorderStripEntries(entries, "standalone:missing", 0);
    expect(ids(next)).toEqual(ids(entries));
  });

  it("never loses or duplicates an entry", () => {
    for (let gap = 0; gap <= entries.length; gap += 1) {
      for (const entry of entries) {
        const next = reorderStripEntries(entries, stripEntryId(entry), gap);
        expect(next).toHaveLength(entries.length);
        expect(new Set(ids(next)).size).toBe(entries.length);
      }
    }
  });
});
