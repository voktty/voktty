import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scriptsRoot = new URL(
  "../../../../src-tauri/src/modules/pty/scripts/",
  import.meta.url,
);

function readScript(name: string): string {
  return readFileSync(new URL(name, scriptsRoot), "utf8");
}

function expectCanonicalMarkerOrder(source: string): void {
  const commandEnd = source.indexOf("133;D");
  const cwd = source.indexOf("]7;file://");
  const promptStart = source.indexOf("133;A");

  expect(commandEnd).toBeGreaterThanOrEqual(0);
  expect(cwd).toBeGreaterThan(commandEnd);
  expect(promptStart).toBeGreaterThan(cwd);
}

describe("shell integration cwd marker order", () => {
  it.each(["bashrc.bash", "zshrc.zsh", "init.fish"])(
    "emits command end, cwd and prompt start in %s",
    (script) => {
      expectCanonicalMarkerOrder(readScript(script));
    },
  );

  it("uses the same order in PowerShell normal and block prompts", () => {
    const profile = readScript("profile.ps1");

    expect(profile).toContain('return "$oscD$osc7$oscA$gap$oscB"');
    expect(profile).toContain('"$oscD$osc7$oscA${original}${oscB}"');
  });
});
