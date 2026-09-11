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

  // The agent harness (Agent Development panel: HarnessApp, the per-CLI
  // adapters, and the diff/arcade surfaces it renders) must stay behind
  // React.lazy so every launch doesn't pay for a feature most sessions never
  // open. Only thin leaf helpers (recents, fs, platform) are allowed eager,
  // via HarnessStack.tsx and the header's new-harness button.
  const HARNESS_HEAVY_PREFIXES = [
    "/modules/harness/components/HarnessApp",
    "/modules/harness/lib/harness/",
    "/modules/harness/surfaces/",
    "/modules/harness/chrome/",
  ];
  it("keeps the agent harness runtime out of the main window's eager graph", () => {
    const { files } = traceEager("src/main.tsx");
    const normalized = files.map((f) => f.replace(/\\/g, "/"));
    const offenders = normalized.filter((file) =>
      HARNESS_HEAVY_PREFIXES.some((prefix) => file.includes(prefix)),
    );
    expect(offenders).toEqual([]);
  }, 15000);

  it("keeps optional Harness workbench surfaces behind local lazy boundaries", () => {
    const { files } = traceEager("src/modules/harness/components/HarnessApp.tsx");
    const normalized = files.map((file) => file.replace(/\\/g, "/"));
    const optionalSurfaces = [
      "/modules/harness/chrome/ApprovalToasts",
      "/modules/harness/chrome/FilePicker",
      "/modules/harness/chrome/UpdateToast",
      "/modules/harness/chrome/UsageFooter",
      "/modules/harness/surfaces/DiffPane",
      "/modules/harness/surfaces/FilePane",
      "/modules/harness/surfaces/GitDiffPane",
      "/modules/harness/surfaces/NotesView",
      "/modules/harness/surfaces/ProjectTerminalDock",
      "/modules/harness/surfaces/SearchView",
      "/modules/harness/surfaces/SessionPane",
      "/modules/harness/surfaces/SettingsView",
    ];
    const offenders = normalized.filter((file) =>
      optionalSurfaces.some((surface) => file.includes(surface)),
    );
    expect(offenders).toEqual([]);
  }, 15000);
});
