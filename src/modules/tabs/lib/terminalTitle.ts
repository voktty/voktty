export function isTerminalTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    value.trim().length > 0 &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
