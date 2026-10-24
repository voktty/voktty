import type { WorkspaceEnv } from "@/modules/workspace";
import type { WebServerInfo } from "@/modules/preview/store/webServerStore";
import { isLocalUrl } from "@/modules/preview/lib/urlSafety";

function nativePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (
    !/^(?:[A-Za-z]:\/|\/)/.test(normalized) ||
    /[\x00-\x1f\x7f]/.test(normalized) ||
    normalized.split("/").some((part) => part === "." || part === "..")
  )
    return null;
  return normalized.replace(/\/+$/, "") || "/";
}

export function previewRelativePath(root: string, file: string): string | null {
  const base = nativePath(root);
  const path = nativePath(file);
  if (!base || !path) return null;
  const insensitive = /^(?:[A-Za-z]:|\/\/)/.test(base);
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const matches = insensitive
    ? path.toLowerCase().startsWith(prefix.toLowerCase())
    : path.startsWith(prefix);
  if (!matches) return null;
  return path.slice(prefix.length).split("/").map(encodeURIComponent).join("/");
}

export function previewFileNavigation(
  file: string,
  root: string | null,
  workspace: WorkspaceEnv,
  servers: readonly WebServerInfo[],
  previewUrl: string,
) {
  if (workspace.kind !== "local" || !nativePath(file)) return null;
  const matching = servers
    .flatMap((server) => {
      const relative = previewRelativePath(server.root_path, file);
      return relative === null ? [] : [{ server, relative }];
    })
    .sort((a, b) => b.server.root_path.length - a.server.root_path.length)[0];
  if (matching)
    return {
      kind: "navigate" as const,
      url: `${matching.server.url}/${matching.relative}`,
    };
  const relative = root ? previewRelativePath(root, file) : null;
  if (relative !== null && isLocalUrl(previewUrl)) {
    const origin = new URL(previewUrl).origin;
    return { kind: "navigate" as const, url: `${origin}/${relative}` };
  }
  const normalizedFile = file.replace(/\\/g, "/");
  const containing = /^[A-Za-z]:\/[^/]+$/.test(normalizedFile)
    ? normalizedFile.slice(0, 3)
    : normalizedFile.replace(/\/[^/]+$/, "") || "/";
  const targetRoot = relative !== null && root ? root : containing;
  const targetPath = previewRelativePath(targetRoot, file);
  if (targetPath === null) return null;
  return { kind: "start" as const, root: targetRoot, relative: targetPath };
}
