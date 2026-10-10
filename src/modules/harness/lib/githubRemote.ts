const REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function githubOwnerRepoFromRemote(
  remoteUrl: string | null,
): string | null {
  if (!remoteUrl) return null;
  const value = remoteUrl.trim();
  const scp = value.match(/^git@github\.com:([^?#]+)$/i);
  let path = scp?.[1] ?? null;
  if (!path) {
    try {
      const parsed = new URL(value);
      if (
        parsed.hostname.toLowerCase() !== "github.com" ||
        !["http:", "https:", "ssh:"].includes(parsed.protocol) ||
        parsed.search ||
        parsed.hash
      ) {
        return null;
      }
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  if (!path) return null;

  const parts = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .split("/");
  if (
    parts.length !== 2 ||
    parts.some(
      (part) =>
        part.length === 0 || part.length > 100 || !REPO_SEGMENT.test(part),
    )
  ) {
    return null;
  }
  return `${parts[0]}/${parts[1]}`;
}
