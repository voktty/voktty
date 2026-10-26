import type { GlobResponse, GrepResponse } from "@/modules/ai/lib/native";
import type { RemoteWorkspaceEnv } from "@/modules/remote";
import { requestRemoteResult } from "@/modules/remote/client";

const MAX_RESULTS = 2000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function posixAbsolute(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\0") &&
    !path.split("/").some((part) => part === "." || part === "..")
  );
}

function searchTarget(env: RemoteWorkspaceEnv, root: string) {
  const sessionId = env.sessionId;
  if (
    sessionId === undefined ||
    !Number.isSafeInteger(sessionId) ||
    sessionId <= 0
  )
    throw new Error("The original remote search workspace is not connected.");
  const base = env.root.replace(/\/+$/, "") || "/";
  const directory = root === "." ? base : root.replace(/\/+$/, "") || "/";
  const prefix = base === "/" ? "/" : `${base}/`;
  if (
    !posixAbsolute(base) ||
    !posixAbsolute(directory) ||
    (directory !== base && !directory.startsWith(prefix))
  )
    throw new Error("Remote search must stay inside its authenticated root.");
  return {
    sessionId,
    directory,
    cwd: directory === base ? "." : directory.slice(prefix.length),
  };
}

function resultCap(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS)
    throw new Error("Invalid remote search result limit.");
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validHit(value: unknown, directory: string): boolean {
  if (!record(value) || typeof value.rel !== "string" || !value.rel)
    return false;
  if (
    value.rel.startsWith("/") ||
    value.rel.includes("\0") ||
    value.rel.split("/").some((part) => !part || part === "." || part === "..")
  )
    return false;
  return value.path === `${directory === "/" ? "" : directory}/${value.rel}`;
}

async function query(
  sessionId: number,
  method: string,
  params: Record<string, unknown>,
  directory: string,
  cap: number,
  grep: boolean,
): Promise<GlobResponse | GrepResponse> {
  if (new TextEncoder().encode(JSON.stringify(params)).length > 256 * 1024)
    throw new Error("Remote search parameters exceed the request limit.");
  const result = await requestRemoteResult<unknown>(sessionId, method, params);
  if (
    !record(result) ||
    !Array.isArray(result.hits) ||
    result.hits.length > cap ||
    typeof result.truncated !== "boolean" ||
    (grep &&
      (!Number.isSafeInteger(result.files_scanned) ||
        (result.files_scanned as number) < 0 ||
        result.cancelled === true)) ||
    new TextEncoder().encode(JSON.stringify(result)).length > MAX_RESPONSE_BYTES
  )
    throw new Error("Invalid remote search response.");
  const hits = result.hits.map((hit: unknown) => {
    if (
      !validHit(hit, directory) ||
      !record(hit) ||
      (grep &&
        (!Number.isSafeInteger(hit.line) ||
          (hit.line as number) < 1 ||
          typeof hit.text !== "string"))
    )
      throw new Error("Invalid remote search response hit.");
    return {
      path: hit.path as string,
      rel: hit.rel as string,
      ...(grep ? { line: hit.line as number, text: hit.text as string } : {}),
    };
  });
  return grep
    ? {
        hits: hits as GrepResponse["hits"],
        truncated: result.truncated,
        files_scanned: result.files_scanned as number,
      }
    : { hits, truncated: result.truncated };
}

export async function remoteSearchGrep(
  env: RemoteWorkspaceEnv,
  params: {
    root: string;
    pattern: string;
    glob?: string[];
    caseInsensitive?: boolean;
    maxResults?: number;
  },
): Promise<GrepResponse> {
  const { sessionId, directory, cwd } = searchTarget(env, params.root);
  const cap = resultCap(params.maxResults, 30);
  return query(
    sessionId,
    "fs.grepIndependent",
    {
      cwd,
      pattern: params.pattern,
      include: params.glob ?? [],
      regex: true,
      caseSensitive: !(params.caseInsensitive ?? false),
      showHidden: false,
      maxResults: cap,
    },
    directory,
    cap,
    true,
  ) as Promise<GrepResponse>;
}

export async function remoteSearchGlob(
  env: RemoteWorkspaceEnv,
  params: { root: string; pattern: string; maxResults?: number },
): Promise<GlobResponse> {
  const { sessionId, directory, cwd } = searchTarget(env, params.root);
  const cap = resultCap(params.maxResults, 500);
  return query(
    sessionId,
    "fs.glob",
    {
      cwd,
      pattern: params.pattern,
      maxResults: cap,
    },
    directory,
    cap,
    false,
  );
}
