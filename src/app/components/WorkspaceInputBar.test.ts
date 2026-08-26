import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("AI composer surface ownership", () => {
  it("does not mount the shared composer in a hidden workspace bar", () => {
    const file = source("app/components/WorkspaceInputBar.tsx");

    expect(file).toContain("const renderAi = hasComposer && aiLoaded && open;");
  });

  it("retries a pending focus request after the lazy composer mounts", () => {
    const file = source("modules/ai/components/AiComposerInput.tsx");

    expect(file).toContain("const focusSignal = useChatStore");
    expect(file).toContain("requestAnimationFrame(() => {");
    expect(file).toContain("cancelAnimationFrame(frame)");
  });
});
