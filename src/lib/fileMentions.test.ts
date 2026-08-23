import { describe, expect, it } from "vitest";
import type { ProjectFile } from "./fs";
import {
  buildMentionIndex,
  fileMentionParts,
  fileMentionsInText,
  mentionLabel,
  mentionTokenAt,
  rankMentionFiles,
  replaceMentionToken,
} from "./fileMentions";

const files: ProjectFile[] = [
  {
    name: "App.tsx",
    path: "/p/apps/desktop/src/App.tsx",
    relative: "apps/desktop/src/App.tsx",
  },
  {
    name: "App.tsx",
    path: "/p/apps/web/src/App.tsx",
    relative: "apps/web/src/App.tsx",
  },
  {
    name: "Composer.tsx",
    path: "/p/src/chrome/Composer.tsx",
    relative: "src/chrome/Composer.tsx",
  },
  {
    name: "read me.md",
    path: "/p/docs/read me.md",
    relative: "docs/read me.md",
  },
];

const index = buildMentionIndex(files);

describe("mentionTokenAt", () => {
  it("reads the @token the cursor is in", () => {
    expect(mentionTokenAt("@Comp", 5)).toEqual({
      start: 0,
      end: 5,
      query: "Comp",
    });
    expect(mentionTokenAt("look at @src/App", 16)).toEqual({
      start: 8,
      end: 16,
      query: "src/App",
    });
  });

  it("ignores emails and mid-word @", () => {
    expect(mentionTokenAt("nick@example.com", 8)).toBeNull();
    expect(mentionTokenAt("a@b", 3)).toBeNull();
  });

  it("closes after a space", () => {
    expect(mentionTokenAt("@App.tsx now", 12)).toBeNull();
  });
});

describe("replaceMentionToken", () => {
  it("inserts @label and a trailing space", () => {
    expect(
      replaceMentionToken("@Comp", { start: 0, end: 5, query: "Comp" }, "Composer.tsx"),
    ).toBe("@Composer.tsx ");
    expect(
      replaceMentionToken("x @a y", { start: 2, end: 4, query: "a" }, "App.tsx"),
    ).toBe("x @App.tsx y");
  });
});

describe("buildMentionIndex", () => {
  it("labels unique basenames short and ambiguous ones by path", () => {
    expect(mentionLabel(files[2], index)).toBe("Composer.tsx");
    expect(mentionLabel(files[0], index)).toBe("apps/desktop/src/App.tsx");
  });

  it("skips paths that cannot survive a whitespace-delimited token", () => {
    expect(index.labels.has("read me.md")).toBe(false);
    expect(index.labelOf.has(files[3].path)).toBe(false);
  });

  it("always accepts the relative path as a label", () => {
    expect(index.labels.get("apps/web/src/App.tsx")).toBe(files[1]);
    expect(index.labels.get("src/chrome/Composer.tsx")).toBe(files[2]);
  });
});

describe("fileMentionParts", () => {
  it("splits known mentions out of the surrounding text", () => {
    expect(fileMentionParts("fix @Composer.tsx now", index.labels)).toEqual([
      { text: "fix " },
      { text: "@Composer.tsx", file: files[2] },
      { text: " now" },
    ]);
  });

  it("leaves unknown mentions and emails alone", () => {
    expect(fileMentionParts("ping @nobody.tsx", index.labels)).toEqual([
      { text: "ping @nobody.tsx" },
    ]);
    expect(fileMentionParts("nick@example.com", index.labels)).toEqual([
      { text: "nick@example.com" },
    ]);
  });

  it("keeps trailing punctuation outside the mention", () => {
    expect(fileMentionParts("see @Composer.tsx, then", index.labels)).toEqual([
      { text: "see " },
      { text: "@Composer.tsx", file: files[2] },
      { text: ", then" },
    ]);
  });
});

describe("fileMentionsInText", () => {
  it("collects each referenced file once", () => {
    const hits = fileMentionsInText(
      "@Composer.tsx and @apps/web/src/App.tsx and @Composer.tsx",
      index.labels,
    );
    expect(hits.map((hit) => hit.label)).toEqual([
      "Composer.tsx",
      "apps/web/src/App.tsx",
    ]);
  });
});

describe("rankMentionFiles", () => {
  it("offers recents first when nothing is typed", () => {
    const ranked = rankMentionFiles(files, "", [files[1].path]);
    expect(ranked[0].path).toBe(files[1].path);
  });

  it("fuzzy matches and drops paths with whitespace", () => {
    const ranked = rankMentionFiles(files, "read", []);
    expect(ranked).toEqual([]);
    expect(rankMentionFiles(files, "compo", [])[0].path).toBe(files[2].path);
  });
});
