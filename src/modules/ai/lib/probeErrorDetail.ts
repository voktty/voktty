import { redactSensitive } from "./redact";

export function probeErrorDetail(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const safe = redactSensitive(message)
    .replace(/https?:\/\/[^\s)"'<>]+/g, "<endpoint>")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/(?<![\w:])(?:[A-Za-z]:[\\/]|\/(?!\/))[^\s"'<>]+/g, "<path>")
    .replace(/\s+/g, " ")
    .trim();
  return safe.slice(0, 240) || undefined;
}
