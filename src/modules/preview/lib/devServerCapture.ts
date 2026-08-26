const ANSI_ESCAPE =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const LOOPBACK_URL =
  /(?:https?:\/\/)?(?:localhost|[a-z0-9-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[(?:::1|::)\])(?::\d{1,5})?(?:\/[^\s<>"'`]*)?/gi;
const MAX_TAIL_LENGTH = 2048;

function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts[0] !== "127") return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isAllowedLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::]" ||
    host === "[::1]" ||
    isLoopbackIpv4(host)
  );
}

/**
 * Converts terminal text into a safe browser origin. Paths, fragments,
 * credentials and query strings are deliberately not retained.
 */
export function normalizeCapturedDevServerUrl(raw: string): string | null {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || !isAllowedLoopbackHost(url.hostname)) {
      return null;
    }
    if (url.port) {
      const port = Number(url.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    }
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
      url.hostname = "localhost";
    }
    return url.origin;
  } catch {
    return null;
  }
}

export type DevServerOutputDetector = {
  push: (chunk: string) => string[];
  reset: () => void;
};

/** Stateful because PTY chunks can split a URL at any byte boundary. */
export function createDevServerOutputDetector(): DevServerOutputDetector {
  let tail = "";
  const seen = new Set<string>();

  return {
    push(chunk) {
      const plain = `${tail}${chunk}`.replace(ANSI_ESCAPE, "");
      const detected: string[] = [];
      for (const match of plain.matchAll(LOOPBACK_URL)) {
        const normalized = normalizeCapturedDevServerUrl(match[0]);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        detected.push(normalized);
      }
      tail = plain.slice(-MAX_TAIL_LENGTH);
      return detected;
    },
    reset() {
      tail = "";
      seen.clear();
    },
  };
}

function normalizedCwd(cwd: string | null): string {
  const value = (cwd ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(value) ? value.toLocaleLowerCase("en-US") : value;
}

export function devServerLinkScope(
  workspaceKey: string,
  cwd: string | null,
  url: string,
): string {
  return `${workspaceKey}\0${normalizedCwd(cwd)}\0${url}`;
}
