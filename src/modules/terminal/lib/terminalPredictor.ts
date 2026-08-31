import { invoke } from "@tauri-apps/api/core";
import { type VokttyHistoryEntry, historyList } from "../block/lib/history";
import type { WorkspaceEnv } from "@/modules/workspace";
import { IS_WINDOWS } from "@/lib/platform";

export type TerminalSuggestKind =
  | "folder"
  | "file"
  | "command"
  | "history"
  | "script";

export type TerminalSuggestItem = {
  text: string;
  kind: TerminalSuggestKind;
  detail?: string;
  score?: number;
};

export type PredictContext = {
  leafId: number;
  workspaceEnv?: WorkspaceEnv;
  cwd?: string | null;
  shellType?: string;
  isUnix?: boolean;
};

export type PredictResult = {
  items: string[];
  structuredItems: TerminalSuggestItem[];
  ghostTail: string;
  isPathContext: boolean;
  hasRealPaths: boolean;
};

type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

const PATH_ONLY_COMMANDS = new Set([
  "cd",
  "pushd",
  "rmdir",
  "mkdir",
]);

const FILE_OR_PATH_COMMANDS = new Set([
  "cd",
  "pushd",
  "ls",
  "dir",
  "cat",
  "type",
  "rm",
  "mkdir",
  "rmdir",
  "cp",
  "mv",
  "code",
  "vim",
  "vi",
  "nano",
  "source",
  "touch",
  "chmod",
  "chown",
  "less",
  "more",
  "head",
  "tail",
  "python",
  "python3",
  "py",
  "node",
  "deno",
  "bun",
  "sh",
  "bash",
  "zsh",
  "ruby",
  "perl",
  "php",
]);

/**
 * Normalizes backslashes to forward slashes for Unix/Docker/SSH/WSL terminals,
 * removing broken Windows prefixes like .\
 */
export function normalizeCommandForEnv(cmd: string, isUnix: boolean): string {
  if (!isUnix) return cmd;

  // On Unix/Docker/SSH, replace .\ with ./ (or strip if right after python/node/etc)
  let normalized = cmd;
  // Convert .\path to ./path or path
  normalized = normalized.replace(/(^|\s)\.\\/g, "$1./");
  // Convert internal backslashes in path-like tokens to forward slashes
  normalized = normalized.replace(/([A-Za-z0-9_.-])\\([A-Za-z0-9_.-])/g, "$1/$2");
  return normalized;
}

/**
 * Detects if the current prompt query is in a path or file argument context
 */
export function isPathOrFileContext(query: string): {
  isPath: boolean;
  command: string;
  argPrefix: string;
  fullPrefix: string;
} {
  const trimmed = query.trimStart();
  if (!trimmed) {
    return { isPath: false, command: "", argPrefix: "", fullPrefix: "" };
  }

  // Check if query starts with ./ or / or \ or ~
  if (
    trimmed.startsWith("./") ||
    trimmed.startsWith(".\\") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    trimmed.startsWith("~/") ||
    /^[A-Za-z]:[/\\]/.test(trimmed)
  ) {
    return {
      isPath: true,
      command: "",
      argPrefix: trimmed,
      fullPrefix: "",
    };
  }

  // Parse command name and argument
  const firstSpaceIdx = trimmed.search(/\s/);
  if (firstSpaceIdx === -1) {
    // Only command typed so far
    return {
      isPath: false,
      command: trimmed.toLowerCase(),
      argPrefix: "",
      fullPrefix: trimmed,
    };
  }

  const command = trimmed.slice(0, firstSpaceIdx).toLowerCase();
  const rawArg = trimmed.slice(firstSpaceIdx);
  const leadingSpaces = rawArg.match(/^\s*/)?.[0] ?? " ";
  const argPrefix = rawArg.trimStart();
  const fullPrefix = trimmed.slice(0, firstSpaceIdx) + leadingSpaces;

  const isPath =
    FILE_OR_PATH_COMMANDS.has(command) ||
    argPrefix.startsWith("./") ||
    argPrefix.startsWith(".\\") ||
    argPrefix.startsWith("/") ||
    argPrefix.startsWith("\\") ||
    argPrefix.startsWith("~/") ||
    /^[A-Za-z]:[/\\]/.test(argPrefix);

  return { isPath, command, argPrefix, fullPrefix };
}

type FsCacheEntry = {
  entries: DirEntry[];
  timestamp: number;
};

const FS_CACHE = new Map<string, FsCacheEntry>();
const FS_CACHE_TTL_MS = 5000;

/**
 * Resolves a relative or absolute directory path against the session cwd
 */
export function resolveDirectory(
  dirPart: string,
  cwd?: string | null,
): string | null {
  if (dirPart.startsWith("~")) return dirPart;
  // Absolute Unix path
  if (dirPart.startsWith("/")) return dirPart || "/";
  // Absolute Windows path
  if (/^[A-Za-z]:[/\\]/.test(dirPart)) return dirPart;

  const cleanCwd = cwd ? cwd.replace(/[/\\]+$/, "") : "";
  const cleanDir = dirPart.replace(/^[./\\]+/, "").replace(/[/\\]+$/, "");

  if (!cleanCwd) return cleanDir || ".";
  const separator = cleanCwd.includes("\\") ? "\\" : "/";
  return cleanDir ? `${cleanCwd}${separator}${cleanDir}` : cleanCwd;
}

/**
 * Live filesystem path discovery (local, WSL, Docker, and remote SSH)
 */
async function queryFilesystemPaths(
  command: string,
  argPrefix: string,
  fullPrefix: string,
  cwd: string,
  isUnix: boolean,
  workspaceEnv?: WorkspaceEnv,
): Promise<TerminalSuggestItem[]> {
  const isWindowsSep = !isUnix && (cwd.includes("\\") || argPrefix.includes("\\"));
  const sep = isWindowsSep ? "\\" : "/";

  // Extract dir part and base name part
  const lastSlash = Math.max(argPrefix.lastIndexOf("/"), argPrefix.lastIndexOf("\\"));
  const dirPart = lastSlash >= 0 ? argPrefix.slice(0, lastSlash + 1) : "";
  const basePart = lastSlash >= 0 ? argPrefix.slice(lastSlash + 1) : argPrefix;

  const targetDir = resolveDirectory(dirPart, cwd);
  if (!targetDir) return [];

  const envKey = workspaceEnv
    ? workspaceEnv.kind === "ssh"
      ? `ssh:${workspaceEnv.connection.host}:${workspaceEnv.connection.user ?? ""}`
      : workspaceEnv.kind === "docker"
        ? `docker:${workspaceEnv.connection.containerId}`
        : workspaceEnv.kind === "wsl"
          ? `wsl:${workspaceEnv.distro}`
          : "local"
    : "local";
  const showHidden = basePart.startsWith(".");
  const cacheKey = `${envKey}:${targetDir}:${showHidden}`;

  let entries: DirEntry[] = [];
  const cached = FS_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < FS_CACHE_TTL_MS) {
    entries = cached.entries;
  } else {
    try {
      entries = await invoke<DirEntry[]>("fs_read_dir", {
        path: targetDir,
        showHidden,
        workspace: workspaceEnv ?? null,
      });
      if (FS_CACHE.size > 200) {
        const oldest = FS_CACHE.keys().next().value;
        if (oldest) FS_CACHE.delete(oldest);
      }
      FS_CACHE.set(cacheKey, { entries, timestamp: Date.now() });
    } catch {
      return [];
    }
  }

  const isCd = PATH_ONLY_COMMANDS.has(command);
  const isPython = command === "python" || command === "python3" || command === "py";
  const isNode = command === "node" || command === "deno" || command === "bun";
  const isShell = command === "sh" || command === "bash" || command === "zsh";

  const lowerBase = basePart.toLowerCase();
  const items: TerminalSuggestItem[] = [];

  for (const entry of entries) {
    if (lowerBase && !entry.name.toLowerCase().startsWith(lowerBase)) {
      continue;
    }

    const isDir = entry.kind === "dir";

    // If command is 'cd' or 'rmdir', only directories are valid
    if (isCd && !isDir) continue;

    let score = 150_000;
    if (isDir) {
      score = isCd ? 220_000 : 170_000;
    } else if (isPython && entry.name.endsWith(".py")) {
      score = 210_000;
    } else if (
      isNode &&
      (entry.name.endsWith(".js") ||
        entry.name.endsWith(".ts") ||
        entry.name.endsWith(".mjs") ||
        entry.name.endsWith(".json"))
    ) {
      score = 210_000;
    } else if (isShell && (entry.name.endsWith(".sh") || entry.name.endsWith(".bash"))) {
      score = 210_000;
    }

    // Exact name prefix match bonus
    if (entry.name.toLowerCase() === lowerBase) {
      score += 20_000;
    }

    const pathSuffix = isDir ? sep : "";
    const combinedPath = `${dirPart}${entry.name}${pathSuffix}`;
    const fullCommand = `${fullPrefix}${combinedPath}`;

    items.push({
      text: fullCommand,
      kind: isDir ? "folder" : "file",
      detail: isDir ? "folder" : "file",
      score,
    });

    if (items.length >= 40) break;
  }

  return items;
}

/**
 * Predicts the most relevant suggestions for the terminal based on:
 * 1. Live filesystem paths (CWD-aware, remote SSH / Docker / WSL aware)
 * 2. Cross-platform universal history (normalized to target environment)
 * 3. Command and syntax awareness
 */
export async function predictTerminalSuggestions(
  query: string,
  context: PredictContext,
  limit = 8,
): Promise<PredictResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      items: [],
      structuredItems: [],
      ghostTail: "",
      isPathContext: false,
      hasRealPaths: false,
    };
  }

  const isUnix =
    context.isUnix ??
    (context.workspaceEnv?.kind === "ssh" ||
      context.workspaceEnv?.kind === "docker" ||
      context.workspaceEnv?.kind === "wsl" ||
      !IS_WINDOWS);

  const { isPath, command, argPrefix, fullPrefix } = isPathOrFileContext(query);

  const realPathItems: TerminalSuggestItem[] = [];

  // 1. Live Filesystem Path Discovery (if in path context)
  const isPathCandidate =
    isPath &&
    (Boolean(context.cwd) ||
      argPrefix.startsWith("/") ||
      argPrefix.startsWith("~") ||
      argPrefix.startsWith(".") ||
      /^[A-Za-z]:[/\\]/.test(argPrefix));

  if (isPathCandidate) {
    try {
      const paths = await queryFilesystemPaths(
        command,
        argPrefix,
        fullPrefix,
        context.cwd || ".",
        isUnix,
        context.workspaceEnv,
      );
      realPathItems.push(...paths);
    } catch {
      // ignore
    }
  }

  // 2. Cross-Platform History Retrieval & Normalization
  let historyEntries: VokttyHistoryEntry[] = [];
  try {
    const targetShell = isUnix ? "unix" : "powershell";
    historyEntries = await historyList(trimmed, targetShell, 20);
    // If few results with strict shell filter, fall back to global history
    if (historyEntries.length < 5) {
      const globalEntries = await historyList(trimmed, undefined, 20);
      const seen = new Set(historyEntries.map((e) => e.cmd));
      for (const ge of globalEntries) {
        if (!seen.has(ge.cmd)) {
          historyEntries.push(ge);
          seen.add(ge.cmd);
        }
      }
    }
  } catch {
    // ignore
  }

  const queryLower = trimmed.toLowerCase();
  const historyItems: TerminalSuggestItem[] = [];

  for (const entry of historyEntries) {
    const normalized = normalizeCommandForEnv(entry.cmd, isUnix);
    const normLower = normalized.toLowerCase();

    // Check if it strictly matches query from the first character
    if (!normLower.startsWith(queryLower)) continue;

    const recencyBonus = entry.last
      ? Math.max(0, 5_000 - Math.min(5_000, Math.floor((Date.now() / 1000 - entry.last) / 3600)))
      : 0;
    const countBonus = Math.min(5_000, (entry.count || 1) * 50);
    let score = recencyBonus + countBonus + 10_000;

    if (normalized === trimmed) {
      score += 20_000;
    }

    // Boost matching environment
    if (isUnix && entry.shell_type === "unix") {
      score += 5_000;
    } else if (!isUnix && entry.shell_type === "powershell") {
      score += 5_000;
    }

    // Heavy penalty for Windows drive letters on Unix/Docker/SSH
    if (isUnix && /^[A-Za-z]:[/\\]/.test(entry.cmd)) {
      score -= 50_000;
    }

    historyItems.push({
      text: normalized,
      kind: "history",
      detail: entry.category || (entry.shell_type ? `[${entry.shell_type}]` : undefined),
      score,
    });
  }

  // 3. Merge, Deduplicate and Rank
  const allItems = [...realPathItems, ...historyItems];
  const seenTexts = new Set<string>();
  const rankedItems: TerminalSuggestItem[] = [];

  allItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (const item of allItems) {
    if (!seenTexts.has(item.text)) {
      seenTexts.add(item.text);
      rankedItems.push(item);
      if (rankedItems.length >= limit) break;
    }
  }

  const items = rankedItems.map((i) => i.text);

  // 4. Ghost Tail Calculation
  let ghostTail = "";
  const queryLowerPrefix = query.toLowerCase();
  const trimmedLowerPrefix = trimmed.toLowerCase();
  const top =
    rankedItems.find(
      (i) =>
        i.text.toLowerCase().startsWith(queryLowerPrefix) &&
        i.text.length > query.length,
    ) ??
    rankedItems.find(
      (i) =>
        i.text.toLowerCase().startsWith(trimmedLowerPrefix) &&
        i.text.length > trimmed.length,
    );

  if (top) {
    if (top.text.toLowerCase().startsWith(queryLowerPrefix)) {
      ghostTail = top.text.slice(query.length);
    } else {
      ghostTail = top.text.slice(trimmed.length).trimStart();
    }
  }

  return {
    items,
    structuredItems: rankedItems,
    ghostTail,
    isPathContext: isPath,
    hasRealPaths: realPathItems.length > 0,
  };
}
