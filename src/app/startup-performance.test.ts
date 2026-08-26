import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function functionBody(file: string, name: string, nextName: string): string {
  const start = file.indexOf(`function ${name}`);
  const end = file.indexOf(`function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return file.slice(start, end);
}

describe("startup performance invariants", () => {
  it("starts the PTY without awaiting renderer fonts", () => {
    const file = source("modules/terminal/lib/useTerminalSession.ts");
    const ensure = functionBody(file, "ensureSession", "deliverPtyBytes");
    expect(ensure).toMatch(
      /session\.ready = \(async \(\) => \{[\s\S]*document\.fonts\.ready;[\s\S]*\}\)\(\);\s*startPtyOpening\(/,
    );
  });

  it("shows a newly bound xterm after replay parsing and one frame", () => {
    const file = source("modules/terminal/lib/rendererPool.ts");
    const schedule = functionBody(
      file,
      "scheduleUnhide",
      "cancelPendingUnhide",
    );
    expect(schedule.match(/requestAnimationFrame/g)).toHaveLength(1);
    expect(file).toMatch(
      /slot\.term\.write\("\\x1b\[\?25h", \(\) => \{[\s\S]*scheduleUnhide/,
    );
  });

  it("deduplicates global terminal theme application", () => {
    const file = source("modules/terminal/lib/rendererPool.ts");
    const apply = functionBody(file, "applyTheme", "applyCursorStyle");
    expect(apply).toContain("signature === appliedThemeSignature");
  });

  it("does not mount the AI sidebar before its first open", () => {
    const file = source("app/App.tsx");
    expect(file).toContain(
      "const [aiSidebarMounted, setAiSidebarMounted] = useState(panelOpen)",
    );
    expect(file).toContain("if (panelOpen) setAiSidebarMounted(true)");
  });

  it("authorizes restored cwd values only for the active tab", () => {
    const file = source("modules/spaces/lib/useSpacesBoot.ts");
    expect(file).toContain("uniqueCwds([activeTab])");
    expect(file).not.toContain("uniqueCwds(restored)");
    expect(file).toContain("if (activeRoot) paths.add(activeRoot)");
  });

  it("runs orphan cleanup and launch request lookup in parallel", () => {
    const file = source("main.tsx");
    expect(file).toContain("Promise.all([");
    expect(file).toContain('invoke("pty_close_all")');
    expect(file).toContain("initLaunchRequests()");
  });
});
