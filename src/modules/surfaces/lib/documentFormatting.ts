import { IS_WINDOWS } from "@/lib/platform";

export function supportsDocumentFormatting(
  path: string | null | undefined,
  environment: { kind: string },
  windows = IS_WINDOWS,
): boolean {
  if (!path || path.length > 32768 || /[\0\r\n]/.test(path)) return false;
  if (/^(?:[a-zA-Z]:[\\/]|[\\/]{2})/.test(path)) return true;
  if (!path.startsWith("/")) return false;
  return (
    environment.kind === "local" || (environment.kind === "wsl" && windows)
  );
}
