import type { WebProjectEntry, WebProjectKind } from "./webProject";

const PORT_BASE = 8100;
const PORT_SPAN = 800;

/**
 * A stable port per project folder, so two projects rarely collide and the
 * same project reuses the same address (and tunnel) every time.
 */
export function previewPortFor(path: string): number {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return PORT_BASE + ((hash >>> 0) % PORT_SPAN);
}

/**
 * Document root of a plain PHP or static project: `public` when the project
 * keeps its entry point there, the folder itself otherwise.
 */
export function webProjectDocroot(
  entries: readonly WebProjectEntry[],
): "public" | "." {
  const hasPublic = entries.some(
    (entry) => entry.kind === "dir" && entry.name.toLowerCase() === "public",
  );
  const hasRootIndex = entries.some(
    (entry) =>
      entry.kind !== "dir" &&
      /^index\.(?:php|html?)$/i.test(entry.name),
  );
  return hasPublic && !hasRootIndex ? "public" : ".";
}

/**
 * Command typed into the remote terminal to serve the project. Built only
 * from the kind, a numeric port and a fixed docroot, so nothing from the
 * folder is ever interpolated into the shell.
 */
export function remoteServerCommand(
  kind: WebProjectKind,
  port: number,
  docroot: "public" | ".",
): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new RangeError("Invalid preview port");
  }
  if (kind === "laravel") {
    return `php artisan serve --host=127.0.0.1 --port=${port}`;
  }
  return `php -S 127.0.0.1:${port} -t ${docroot}`;
}

export function portOfUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}
