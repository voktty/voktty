import { expect, it } from "vitest";
import { meaningfulStderr, pushStderrLine } from "./stderrTail";

it("names the error behind a Node launcher crash, not the Node trailer", () => {
  const tail: string[] = [];
  for (const line of [
    "file:///C:/npm/node_modules/@openai/codex/bin/codex.js:108",
    "  throw new Error(",
    "  ^",
    "",
    "Error: Missing optional dependency @openai/codex-win32-x64. Reinstall Codex",
    "    at findCodexExecutable (file:///C:/npm/codex.js:108:9)",
    "    at file:///C:/npm/codex.js:113:20",
    "",
    "Node.js v22.23.2",
  ])
    pushStderrLine(tail, line);
  expect(meaningfulStderr(tail)).toBe(
    "Error: Missing optional dependency @openai/codex-win32-x64. Reinstall Codex",
  );
});

it("falls back to the last informative line and stays bounded", () => {
  const tail: string[] = [];
  for (let i = 0; i < 50; i += 1) pushStderrLine(tail, `line ${i}`);
  expect(tail).toHaveLength(20);
  expect(meaningfulStderr(tail)).toBe("line 49");
  expect(meaningfulStderr([])).toBe("");
});
