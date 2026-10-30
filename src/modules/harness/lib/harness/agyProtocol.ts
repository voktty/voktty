export function supportsAgyStreamInput(output: string): boolean {
  if (output.length > 256) return false;
  const match =
    /^(?:(?:Antigravity(?: CLI)?|agy)(?: version)?\s+v?|v)?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/i.exec(
      output.trim(),
    );
  if (!match) return false;
  const version = match.slice(1, 4).map(Number);
  if (!version.every(Number.isSafeInteger)) return false;
  const [major, minor, patch] = version;
  return (
    major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 15)))
  );
}
