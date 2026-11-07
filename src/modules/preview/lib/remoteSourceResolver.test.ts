import { describe, expect, it, vi } from "vitest";
import type { RemoteWorkspaceEnv } from "@/modules/remote";
import {
  remoteSourcePatterns,
  resolveRemoteElementSource,
} from "./remoteSourceResolver";

const env = { kind: "ssh", sessionId: 1 } as unknown as RemoteWorkspaceEnv;
const target = { env, root: "/srv/site" };
const hit = (rel: string, line = 7) => ({
  path: `/srv/site/${rel}`,
  rel,
  line,
  text: "",
});

describe("remoteSourcePatterns", () => {
  it("prefers the id, then classes, then a short text", () => {
    const patterns = remoteSourcePatterns({
      tagName: "div",
      idAttr: "hero",
      classList: ["card", "big"],
      innerText: "Welcome home",
    });
    expect(patterns.map((p) => p.matchedBy)).toEqual(["id", "class", "class", "text"]);
  });

  it("escapes regex syntax and drops unsafe identifiers", () => {
    const patterns = remoteSourcePatterns({
      tagName: "p",
      idAttr: 'x"; rm',
      classList: ["a(b"],
      innerText: "Price (€) [new]",
    });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].pattern).toBe("Price \\(€\\) \\[new\\]");
  });
});

describe("resolveRemoteElementSource", () => {
  it("returns the first hit of the most specific pattern", async () => {
    const grep = vi.fn().mockResolvedValue({
      hits: [hit("resources/views/home.blade.php", 12)],
      truncated: false,
      files_scanned: 3,
    });
    const match = await resolveRemoteElementSource(
      { tagName: "div", idAttr: "hero" },
      target,
      grep,
    );
    expect(grep).toHaveBeenCalledTimes(1);
    expect(match).toMatchObject({
      file_path: "/srv/site/resources/views/home.blade.php",
      line_number: 12,
      framework: "laravel",
      matched_by: "id",
    });
  });

  it("skips vendor code and falls through to the next pattern", async () => {
    const grep = vi
      .fn()
      .mockResolvedValueOnce({ hits: [hit("vendor/x/a.php")], truncated: false, files_scanned: 1 })
      .mockResolvedValueOnce({ hits: [hit("index.php", 3)], truncated: false, files_scanned: 1 });
    const match = await resolveRemoteElementSource(
      { tagName: "div", idAttr: "a", classList: ["card"] },
      target,
      grep,
    );
    expect(match?.relative_path).toBe("index.php");
    expect(match?.matched_by).toBe("class");
  });

  it("returns null when nothing matches", async () => {
    const grep = vi.fn().mockResolvedValue({ hits: [], truncated: false, files_scanned: 0 });
    await expect(
      resolveRemoteElementSource({ tagName: "div", idAttr: "gone" }, target, grep),
    ).resolves.toBeNull();
  });
});
