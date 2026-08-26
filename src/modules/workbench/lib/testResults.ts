export type TestResultStatus = "passed" | "failed" | "skipped";

export type TestResult = {
  id: string;
  name: string;
  file?: string;
  status: TestResultStatus;
};

const MAX_RESULTS = 2_000;
const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export function parseTestResults(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.replace(ANSI_ESCAPE, "").split(/\r?\n/);
  for (let index = 0; index < lines.length && results.length < MAX_RESULTS; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const vitest = line.match(/^([✓×↓])\s+(.+?)\s+>\s+(.+?)(?:\s+\d+(?:\.\d+)?m?s)?$/u);
    if (vitest) {
      results.push({
        id: `line:${index}`,
        file: vitest[2]?.trim(),
        name: vitest[3]?.trim() ?? "",
        status: vitest[1] === "✓" ? "passed" : vitest[1] === "↓" ? "skipped" : "failed",
      });
      continue;
    }
    const rust = line.match(/^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)$/);
    if (rust) {
      results.push({
        id: `line:${index}`,
        name: rust[1]?.trim() ?? "",
        status: rust[2] === "ok" ? "passed" : rust[2] === "ignored" ? "skipped" : "failed",
      });
    }
  }
  return results;
}
