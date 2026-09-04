import { describe, expect, it } from "vitest";
import { traceEager } from "../../scripts/eager-graph.mjs";

// Locks the startup-bundle invariant: the heavy editor / AI / markdown stacks
// must stay out of the eager graph of both window entries so they load only
// when the user opens those surfaces. A static import that re-introduces any of
// these (e.g. a barrel re-export of chat runtime, or a `cn`-style util getting
// absorbed into a feature chunk) will fail here. xterm and motion are
// intentionally eager (terminal-first shell) and are not asserted against.
const HEAVY = ["@ai-sdk", "ai", "streamdown", "@codemirror", "@uiw"];

function heavyEagerHits(entry: string): string[] {
  const { hits } = traceEager(entry, HEAVY);
  return [...hits.entries()].map(([pkg, info]) => `${pkg} <- ${info.file}`);
}

describe("startup bundle budget", () => {
  it("main window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/main.tsx")).toEqual([]);
  }, 15000);

  it("settings window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/settings/main.tsx")).toEqual([]);
  }, 15000);

  it("keeps MCP management and clients outside both eager graphs", () => {
    for (const entry of ["src/main.tsx", "src/settings/main.tsx"]) {
      const { files } = traceEager(entry);
      expect(
        files.filter((file) =>
          file.replace(/\\/g, "/").includes("/modules/mcp/"),
        ),
      ).toEqual([]);
    }
  }, 15000);
});
