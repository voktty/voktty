import { invoke } from "@tauri-apps/api/core";

export type LaunchSource =
  | "coldStart"
  | "secondInstance"
  | "opened"
  | "controlCli";

export type LaunchIntent =
  | "restoreLastSession"
  | "openFilesOnly"
  | "openDirectoryOnly"
  | "openFilesInCurrentSession"
  | "openDirectoryInCurrentSession"
  | "newStandaloneTab";

export type LaunchRequest = {
  requestId: string;
  source: LaunchSource;
  intent: LaunchIntent;
  paths: string[];
  sourceCwd: string | null;
  line?: number;
  column?: number;
  focus?: boolean;
};

export type LaunchBootstrap = {
  instanceId: string;
  requests: LaunchRequest[];
};

let bootstrap: LaunchBootstrap = { instanceId: "web", requests: [] };

export async function initLaunchRequests(): Promise<void> {
  bootstrap = await invoke<LaunchBootstrap>("launch_bootstrap").catch(() => ({
    instanceId: `web-${globalThis.crypto.randomUUID()}`,
    requests: [],
  }));
}

export async function refreshLaunchBootstrap(): Promise<LaunchBootstrap> {
  bootstrap = await invoke<LaunchBootstrap>("launch_bootstrap").catch(
    () => bootstrap,
  );
  return bootstrap;
}

export function getLaunchBootstrap(): LaunchBootstrap {
  return bootstrap;
}

export function getInitialLaunchRequest(): LaunchRequest | null {
  return bootstrap.requests[0] ?? null;
}

export function selectBootLaunchRequest(
  requests: readonly LaunchRequest[],
  fallback: LaunchRequest | null,
): LaunchRequest | null {
  return (
    requests.find(
      (request) =>
        request.source === "opened" &&
        (request.intent === "openFilesOnly" ||
          request.intent === "openDirectoryOnly"),
    ) ??
    requests.find((request) => request.source === "coldStart") ??
    fallback ??
    requests[0] ??
    null
  );
}

export function initialBootIntent(request: LaunchRequest | null): LaunchIntent {
  return request?.intent ?? "restoreLastSession";
}

export function normalizeLaunchPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const path of paths) {
    const value = path.replace(/\\/g, "/");
    const key = launchPathKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function launchPathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function launchParentPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  if (separator < 0) return undefined;
  if (separator === 0) return "/";
  if (separator === 2 && /^[a-zA-Z]:/.test(normalized)) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, separator);
}

export function controlLaunchRequest(input: {
  requestId: string;
  path: string;
  line?: number;
  column?: number;
  focus: boolean;
}): LaunchRequest {
  return {
    requestId: input.requestId,
    source: "controlCli",
    intent: "openFilesInCurrentSession",
    paths: normalizeLaunchPaths([input.path]),
    sourceCwd: null,
    ...(input.line !== undefined && { line: input.line }),
    ...(input.column !== undefined && { column: input.column }),
    focus: input.focus,
  };
}

export function launchRequestCwd(
  request: LaunchRequest | null,
): string | undefined {
  if (!request) return undefined;
  if (
    request.intent === "openDirectoryOnly" ||
    request.intent === "openDirectoryInCurrentSession"
  ) {
    return normalizeLaunchPaths(request.paths)[0];
  }
  if (
    request.intent === "openFilesOnly" ||
    request.intent === "openFilesInCurrentSession"
  ) {
    const first = normalizeLaunchPaths(request.paths)[0];
    return (first && launchParentPath(first)) || request.sourceCwd || undefined;
  }
  return request.sourceCwd ?? undefined;
}

export type LaunchRequestDeduper = {
  begin: (requestId: string) => boolean;
  complete: (requestId: string) => void;
  fail: (requestId: string) => void;
};

export function createLaunchRequestDeduper(): LaunchRequestDeduper {
  const applying = new Set<string>();
  const applied = new Set<string>();
  return {
    begin(requestId) {
      if (applying.has(requestId) || applied.has(requestId)) return false;
      applying.add(requestId);
      return true;
    },
    complete(requestId) {
      applying.delete(requestId);
      applied.add(requestId);
    },
    fail(requestId) {
      applying.delete(requestId);
    },
  };
}
