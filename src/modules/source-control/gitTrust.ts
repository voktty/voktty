const TRUST_MARKERS = [
  "dubious ownership",
  "safe.directory",
  "outside the authorized workspace",
  "not in the list of safe directories",
  "unsafe repository",
  "unauthorized",
];

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** True when the failure is Git or the workspace refusing the folder, the only
 * case where trusting it can help. */
export function isGitTrustError(error: unknown): boolean {
  const message = messageOf(error).toLowerCase();
  return TRUST_MARKERS.some((marker) => message.includes(marker));
}

/** Folders on another machine are not authorized or trusted from this one. */
export function isRemoteWorkspacePath(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith("remote://");
}

/** The folder the failure names, or `fallbackContextPath`; null when the error
 * is not about trust. */
export function extractDubiousOwnershipPath(
  error: unknown,
  fallbackContextPath: string | null,
): string | null {
  if (!isGitTrustError(error)) return null;
  const message = messageOf(error);
  const match = message.match(
    /(?:repository\s+at|workspace:)\s+('[^']+'|"[^"]+"|[^\s,]+)/i,
  );
  if (match) {
    const extracted = match[1].replace(/^['"]|['"]$/g, "").trim();
    if (extracted.length > 0) return extracted;
  }
  return fallbackContextPath;
}

/** Whether the Authorize action applies to a failed diff or status read. */
export function canOfferTrust(error: unknown, path: string): boolean {
  return !isRemoteWorkspacePath(path) && isGitTrustError(error);
}
