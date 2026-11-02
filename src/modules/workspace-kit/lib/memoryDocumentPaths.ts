import manifest from "@/../templates/workspace-kit/manifest.json";
import { checkReadable } from "@/modules/ai/lib/security";

const encoder = new TextEncoder();
const fixed = new Set([
  ...manifest.files.map(({ source }) =>
    source.startsWith("root/")
      ? source.slice(5)
      : source.replace(/^dot-voktty\//, ".voktty/"),
  ),
  ".voktty/kit.lock.json",
]);

export function isMemoryDocumentPath(path: string): boolean {
  if (
    !path ||
    encoder.encode(path).length > 4096 ||
    /[\p{Cc}\\:%?#]/u.test(path) ||
    !checkReadable(path).ok
  )
    return false;
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  const parts = path.split("/");
  if (
    parts.length > 16 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        encoder.encode(part).length > 256,
    )
  )
    return false;
  if (fixed.has(path)) return true;
  if (parts.length < 3 || parts[0] !== ".voktty" || !path.endsWith(".md"))
    return false;
  if (
    [
      "plans",
      "domains",
      "architecture",
      "rituals",
      "external",
      "archive",
      "capture",
    ].includes(parts[1])
  )
    return true;
  return (
    parts.length >= 4 &&
    ((parts[1] === "team" && parts[2] === "roles") ||
      (parts[1] === "continuity" && parts[2] === "handoffs"))
  );
}
