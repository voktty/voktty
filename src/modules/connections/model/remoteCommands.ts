import { setRemoteCommandRunner } from "@/modules/harness/lib/fs";
import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  RemoteRequestError,
  requestRemoteResult,
} from "@/modules/remote/client";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { remoteMachineFor, remoteRequest } from "./connections";
import {
  parseRemotePath,
  remotePath,
  remoteProjectForPath,
} from "./remoteProjects";
import {
  remoteSshConnectionForProfile,
  remoteSshConnectionIdForEnvironment,
} from "./remoteSshProfiles";

/** File commands a connected machine answers exactly as this computer does. */
const HOST_COMMANDS = new Set([
  "list_dir",
  "list_project_files",
  "read_text_file",
  "read_binary_file",
  "read_file_preview",
  "write_text_file",
  "stat_files",
  "create_path",
  "rename_path",
  "delete_path",
  "copy_path",
  "move_path",
  "git_diff_index",
  "git_diff_files",
  "git_diff_stats",
  "git_file_diff",
  "git_stage_contents",
  "git_stage_file",
  "git_unstage_file",
  "git_discard_file",
  "git_discard_all",
  "git_stage_all",
  "git_unstage_all",
  "git_commit",
  "git_head_message",
  "git_push",
  "git_pull",
  "git_sync",
  "git_pr_status",
  "git_pr_create",
  "git_history",
  "git_commit_files",
  "git_commit_file_diff",
  "git_staged_context",
  "git_range_context",
  "git_branches",
  "git_checkout",
  "git_create_branch",
  "git_stash",
  "git_worktrees",
  "search_project",
]);
/** Arguments that hold paths; everything else is passed through untouched. */
const PATH_ARGS = ["path", "cwd", "parent", "from", "destParent", "paths"];
/** Commands whose string result is a path. */
const PATH_RESULTS = new Set([
  "create_path",
  "rename_path",
  "copy_path",
  "move_path",
]);
/** Commands whose result entries carry a `path`. */
const ENTRY_RESULTS = new Set(["list_dir", "list_project_files", "stat_files"]);

const PROFILE_HELPER_COMMANDS = new Set([
  "list_dir",
  "list_project_files",
  "read_text_file",
  "read_binary_file",
  "read_file_preview",
  "write_text_file",
  "stat_files",
  "create_path",
  "rename_path",
  "delete_path",
  "copy_path",
  "move_path",
  "search_project",
]);

const HELPER_FS = {
  listDir: "fs.readDir",
  readFile: "fs.readFile",
  readBinaryFile: "fs.readBinaryFile",
  writeFile: "fs.writeFile",
  stat: "fs.stat",
  createFile: "fs.createFile",
  createDir: "fs.createDir",
  rename: "fs.rename",
  copy: "fs.copy",
  delete: "fs.delete",
} as const;

type RemotePathReference = {
  value: string;
  environmentId: string;
  hostPath: string;
};

type HelperDirectoryEntry = {
  name: string;
  kind: "directory" | "file" | "symlink";
  size: number;
  mtime: number;
  isSymlink?: boolean;
};

const PROJECT_WALK_SKIPS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".jj",
  "node_modules",
  "bower_components",
  ".pnpm-store",
  ".yarn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".vite",
  ".turbo",
  ".parcel-cache",
  ".angular",
  ".vercel",
  ".netlify",
  ".output",
  ".cache",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".ipynb_checkpoints",
  ".eggs",
  ".gradle",
  "obj",
  "vendor",
  "_build",
  "deps",
  ".dart_tool",
  "dist-newstyle",
  ".stack-work",
  ".build",
  "zig-cache",
  "zig-out",
  "cmake-build-debug",
  "cmake-build-release",
  ".idea",
  "coverage",
  ".nyc_output",
  ".terraform",
]);

const UNAVAILABLE = "This isn’t available for projects on another machine yet.";
const OUTDATED =
  "Update Terax Host in Connections settings to use this project’s files.";

const PROFILE_UNAVAILABLE =
  "This operation is not available for native SSH projects yet.";

function pathReferences(args: Record<string, unknown>): RemotePathReference[] {
  const values: string[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (typeof value === "string") {
      values.push(value);
    }
  };
  for (const key of PATH_ARGS) collect(args[key]);
  const options = args.options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    collect((options as Record<string, unknown>).cwd);
  }
  return values.map((value) => {
    const parsed = parseRemotePath(value);
    if (!parsed) {
      throw new Error("Files can only be copied or moved within one machine.");
    }
    return { value, ...parsed };
  });
}

function normalizeRemoteAbsolute(path: string): string {
  const value = path.replace(/\\/g, "/");
  if (!value.startsWith("/")) {
    throw new Error("The native SSH helper requires a POSIX project path.");
  }
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      throw new Error("Remote paths cannot leave their saved project root.");
    }
    parts.push(part);
  }
  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

function relativeToRemoteRoot(root: string, path: string): string {
  const normalizedRoot = normalizeRemoteAbsolute(root);
  const normalizedPath = normalizeRemoteAbsolute(path);
  if (normalizedPath === normalizedRoot) return ".";
  const prefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(prefix)) {
    throw new Error("Remote paths cannot leave their saved project root.");
  }
  return normalizedPath.slice(prefix.length);
}

function joinRemotePath(root: string, relative: string): string {
  const normalizedRoot = normalizeRemoteAbsolute(root);
  const normalizedRelative =
    relative === "." ? "" : relative.replace(/^\/+/, "");
  return normalizedRelative
    ? `${normalizedRoot === "/" ? "" : normalizedRoot}/${normalizedRelative}`
    : normalizedRoot;
}

function joinRelativePath(...parts: string[]): string {
  const joined = parts
    .filter((part) => part && part !== ".")
    .join("/")
    .replace(/\/{2,}/g, "/");
  return joined || ".";
}

function relativeNameParts(name: string): string[] {
  const normalized = name.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error("The new name must stay inside the saved project.");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.length > 255)
  ) {
    throw new Error("The new name is not valid.");
  }
  return parts;
}

function helperRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("The remote helper returned an invalid search path.");
  }
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.length > 255)
  ) {
    throw new Error(
      "The remote helper returned a search path outside the project.",
    );
  }
  return parts.join("/");
}

function searchPatterns(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "string") {
    throw new Error("The project search patterns are invalid.");
  }
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The remote command requires ${key}.`);
  }
  return value;
}

async function helperStat(sessionId: number, path: string) {
  return requestRemoteResult<{
    size: number;
    mtime: number;
    kind: "file" | "dir";
  }>(sessionId, HELPER_FS.stat, { path });
}

async function ensureRemoteDirectories(
  sessionId: number,
  relativeDirectory: string,
): Promise<void> {
  const parts = relativeDirectory === "." ? [] : relativeDirectory.split("/");
  let current = ".";
  for (const part of parts) {
    current = joinRelativePath(current, part);
    try {
      const existing = await helperStat(sessionId, current);
      if (existing.kind !== "dir") {
        throw new Error("A path component already exists as a file.");
      }
    } catch (error) {
      if (
        !(error instanceof RemoteRequestError) ||
        error.code !== "stat_failed"
      ) {
        throw error;
      }
      try {
        await requestRemoteResult(sessionId, HELPER_FS.createDir, {
          path: current,
        });
      } catch (createError) {
        const existing = await helperStat(sessionId, current).catch(
          () => undefined,
        );
        if (existing?.kind !== "dir") throw createError;
      }
    }
  }
}

async function helperListDirectory(
  sessionId: number,
  relativePath: string,
): Promise<HelperDirectoryEntry[]> {
  const result = await requestRemoteResult<{
    entries: HelperDirectoryEntry[];
  }>(sessionId, HELPER_FS.listDir, { path: relativePath });
  return result.entries;
}

async function listProjectFilesWithHelper(
  sessionId: number,
  environmentId: string,
  root: string,
): Promise<Array<{ name: string; path: string; relative: string }>> {
  const exactIgnores = new Set([".git"]);
  const suffixIgnores: string[] = [];
  try {
    const ignoreFile = await requestRemoteResult<{ content: string }>(
      sessionId,
      HELPER_FS.readFile,
      { path: ".gitignore" },
    );
    for (const raw of ignoreFile.content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      const pattern = line.replace(/\/+$/, "");
      if (pattern.includes("/")) continue;
      if (pattern.startsWith("*.") && !pattern.slice(2).includes("*")) {
        suffixIgnores.push(`.${pattern.slice(2)}`);
      } else if (!pattern.includes("*")) {
        exactIgnores.add(pattern);
      }
    }
  } catch {
    // Projects without a root .gitignore use the built-in skip list only.
  }

  const isIgnored = (name: string) =>
    exactIgnores.has(name) ||
    suffixIgnores.some((suffix) => name.endsWith(suffix));
  const found: Array<{ name: string; path: string; relative: string }> = [];
  const pending = ["."];
  let visitedDirectories = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    visitedDirectories += 1;
    if (visitedDirectories > 4000) {
      throw new Error("The remote project contains too many folders to list.");
    }
    for (const entry of await helperListDirectory(sessionId, directory)) {
      if (entry.name === ".DS_Store" || isIgnored(entry.name)) continue;
      const relative = joinRelativePath(directory, entry.name);
      if (entry.kind === "directory") {
        if (!entry.isSymlink && !PROJECT_WALK_SKIPS.has(entry.name)) {
          pending.push(relative);
        }
      } else {
        found.push({
          name: entry.name,
          relative,
          path: remotePath(environmentId, joinRemotePath(root, relative)),
        });
        if (found.length >= 20_000) {
          return found.sort((left, right) =>
            left.relative.localeCompare(right.relative),
          );
        }
      }
    }
  }
  return found.sort((left, right) =>
    left.relative.localeCompare(right.relative),
  );
}

async function runProfileFileCommand(
  command: string,
  args: Record<string, unknown>,
  environmentId: string,
  sessionId: number,
  root: string,
  relativePath: (value: unknown) => string,
): Promise<unknown> {
  if (!PROFILE_HELPER_COMMANDS.has(command))
    throw new Error(PROFILE_UNAVAILABLE);
  const remoteResultPath = (value: string) => remotePath(environmentId, value);
  if (command === "list_dir") {
    const relative = relativePath(args.path);
    const entries = await helperListDirectory(sessionId, relative);
    return entries
      .map((entry) => ({
        name: entry.name,
        path: remoteResultPath(
          joinRemotePath(root, joinRelativePath(relative, entry.name)),
        ),
        isDir: entry.kind === "directory",
        ignored: entry.name === ".git",
      }))
      .sort(
        (left, right) =>
          Number(right.isDir) - Number(left.isDir) ||
          left.name
            .toLocaleLowerCase("en-US")
            .localeCompare(right.name.toLocaleLowerCase("en-US")),
      );
  }
  if (command === "list_project_files") {
    return listProjectFilesWithHelper(sessionId, environmentId, root);
  }
  if (command === "search_project") {
    const options = args.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new Error("The project search options are invalid.");
    }
    const searchOptions = options as Record<string, unknown>;
    const query = requireString(searchOptions, "query").trim();
    if (!query) return { matches: [], truncated: false };
    const result = await requestRemoteResult<{
      hits: Array<{
        rel: string;
        line: number;
        column: number;
        text: string;
      }>;
      truncated: boolean;
    }>(sessionId, "fs.grep", {
      pattern: query,
      cwd: relativePath(searchOptions.cwd),
      include: searchPatterns(searchOptions.include),
      exclude: searchPatterns(searchOptions.exclude),
      caseSensitive: searchOptions.caseSensitive === true,
      wholeWord: searchOptions.wholeWord === true,
      regex: searchOptions.regex === true,
      showHidden: true,
      maxResults: 500,
    });
    if (!result || !Array.isArray(result.hits)) {
      throw new Error("The remote helper returned an invalid search result.");
    }
    const matches = result.hits.map((hit) => {
      if (
        !hit ||
        typeof hit !== "object" ||
        typeof hit.text !== "string" ||
        !Number.isSafeInteger(hit.line) ||
        hit.line < 1 ||
        !Number.isSafeInteger(hit.column) ||
        hit.column < 1
      ) {
        throw new Error("The remote helper returned an invalid search match.");
      }
      const relative = helperRelativePath(hit.rel);
      return {
        path: remoteResultPath(joinRemotePath(root, relative)),
        relative,
        line: hit.line,
        column: hit.column,
        preview: hit.text,
      };
    });
    return { matches, truncated: result.truncated === true };
  }
  if (command === "read_text_file") {
    const result = await requestRemoteResult<{ content: string }>(
      sessionId,
      HELPER_FS.readFile,
      { path: relativePath(args.path) },
    );
    return result.content;
  }
  if (command === "read_binary_file") {
    const result = await requestRemoteResult<{ contentBase64: string }>(
      sessionId,
      HELPER_FS.readBinaryFile,
      { path: relativePath(args.path) },
    );
    return result.contentBase64;
  }
  if (command === "read_file_preview") {
    const result = await requestRemoteResult<{ content: string }>(
      sessionId,
      HELPER_FS.readFile,
      { path: relativePath(args.path) },
    );
    if (result.content.includes("\0")) throw new Error("Binary file");
    const lines = result.content.split(/\r?\n/);
    if (result.content === "") lines.length = 0;
    else if (result.content.endsWith("\n")) lines.pop();
    const startLine = Math.max(1, Number(args.startLine) || 1);
    const maxLines = Math.min(12, Math.max(1, Number(args.maxLines) || 6));
    return lines
      .slice(startLine - 1, startLine - 1 + maxLines)
      .map((line) =>
        line.length > 200 ? `${[...line].slice(0, 199).join("")}…` : line,
      );
  }
  if (command === "write_text_file") {
    const expectedContent = args.expectedContent;
    await requestRemoteResult(sessionId, HELPER_FS.writeFile, {
      path: relativePath(args.path),
      content: requireString(args, "content"),
      ...(typeof expectedContent === "string" ? { expectedContent } : {}),
    });
    return undefined;
  }
  if (command === "stat_files") {
    const paths = args.paths;
    if (!Array.isArray(paths))
      throw new Error("The remote command requires paths.");
    return Promise.all(
      paths.map(async (path) => {
        try {
          const stat = await helperStat(sessionId, relativePath(path));
          return {
            path,
            mtimeMs: stat.kind === "file" ? stat.mtime : null,
          };
        } catch {
          return { path, mtimeMs: null };
        }
      }),
    );
  }
  if (command === "create_path") {
    const parent = relativePath(args.parent);
    const target = joinRelativePath(
      parent,
      ...relativeNameParts(requireString(args, "name")),
    );
    const parentDirectory = target.includes("/")
      ? target.slice(0, target.lastIndexOf("/")) || "."
      : ".";
    await ensureRemoteDirectories(sessionId, parentDirectory);
    let result: { path: string };
    if (args.isDir === true) {
      result = await requestRemoteResult<{ path: string }>(
        sessionId,
        HELPER_FS.createDir,
        { path: target },
      );
    } else {
      result = await requestRemoteResult<{ path: string }>(
        sessionId,
        HELPER_FS.createFile,
        { path: target },
      );
    }
    return remoteResultPath(result.path);
  }
  if (command === "rename_path") {
    const source = relativePath(args.path);
    const sourceParent = source.includes("/")
      ? source.slice(0, source.lastIndexOf("/"))
      : ".";
    const target = joinRelativePath(
      sourceParent,
      ...relativeNameParts(requireString(args, "name")),
    );
    const targetParent = target.includes("/")
      ? target.slice(0, target.lastIndexOf("/"))
      : ".";
    await ensureRemoteDirectories(sessionId, targetParent);
    if (target === source)
      return remoteResultPath(joinRemotePath(root, source));
    const result = await requestRemoteResult<{ path: string }>(
      sessionId,
      HELPER_FS.rename,
      { from: source, to: target },
    );
    return remoteResultPath(result.path);
  }
  if (command === "delete_path") {
    await requestRemoteResult(sessionId, HELPER_FS.delete, {
      path: relativePath(args.path),
    });
    return undefined;
  }
  if (command === "copy_path") {
    const result = await requestRemoteResult<{ path: string }>(
      sessionId,
      HELPER_FS.copy,
      {
        from: relativePath(args.from),
        destParent: relativePath(args.destParent),
      },
    );
    return remoteResultPath(result.path);
  }
  if (command === "move_path") {
    const source = relativePath(args.from);
    const destinationParent = relativePath(args.destParent);
    const sourceParts = source.split("/").filter(Boolean);
    const name = sourceParts[sourceParts.length - 1];
    if (!name || source === ".")
      throw new Error("The workspace root cannot be moved.");
    const sourceParent = source.includes("/")
      ? source.slice(0, source.lastIndexOf("/"))
      : ".";
    if (destinationParent === sourceParent) {
      return remoteResultPath(joinRemotePath(root, source));
    }
    const result = await requestRemoteResult<{ path: string }>(
      sessionId,
      HELPER_FS.rename,
      { from: source, to: joinRelativePath(destinationParent, name) },
    );
    return remoteResultPath(result.path);
  }
  throw new Error(PROFILE_UNAVAILABLE);
}

async function runNativeProfileCommand(
  command: string,
  args: Record<string, unknown>,
  references: RemotePathReference[],
  environmentId: string,
): Promise<unknown> {
  if (!PROFILE_HELPER_COMMANDS.has(command))
    throw new Error(PROFILE_UNAVAILABLE);
  const connectionId = remoteSshConnectionIdForEnvironment(environmentId);
  if (!connectionId) throw new Error("The saved SSH connection id is invalid.");
  const project = remoteProjectForPath(references[0].value);
  if (!project) throw new Error("This path is outside a saved remote project.");
  for (const reference of references) {
    const owner = remoteProjectForPath(reference.value);
    if (
      reference.environmentId !== environmentId ||
      !owner ||
      owner.key !== project.key
    ) {
      throw new Error(
        "Files can only be accessed within one saved remote project.",
      );
    }
    relativeToRemoteRoot(project.cwd, reference.hostPath);
  }
  const normalizedProjectRoot = normalizeRemoteAbsolute(project.cwd);
  if (normalizedProjectRoot === "/" && project.cwd !== "/") {
    throw new Error("The saved remote project root is invalid.");
  }
  const profile = (usePreferencesStore.getState().sshConnections ?? []).find(
    (entry) => entry.id === connectionId,
  );
  if (!profile)
    throw new Error("The saved SSH connection for this project is missing.");
  const session = await openRemoteWorkspace(
    remoteSshConnectionForProfile(profile),
    normalizedProjectRoot,
  );
  try {
    const sessionRoot = normalizeRemoteAbsolute(session.workspace_root);
    if (sessionRoot !== normalizedProjectRoot) {
      throw new Error(
        "The native SSH helper did not open the saved project root.",
      );
    }
    return await runProfileFileCommand(
      command,
      args,
      environmentId,
      session.session_id,
      sessionRoot,
      (value) => {
        if (typeof value !== "string") {
          throw new Error("The remote command is missing a project path.");
        }
        const parsed = parseRemotePath(value);
        if (!parsed || parsed.environmentId !== environmentId) {
          throw new Error(
            "Files can only be accessed within one remote project.",
          );
        }
        return relativeToRemoteRoot(sessionRoot, parsed.hostPath);
      },
    );
  } finally {
    await closeRemoteWorkspace(session.session_id).catch(() => undefined);
  }
}

/** Runs a file command whose paths are `remote://` paths on the machine that
 * owns them, translating paths both ways so callers never see host paths. */
export async function runRemoteCommand(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!HOST_COMMANDS.has(command)) throw new Error(UNAVAILABLE);
  const references = pathReferences(args);
  if (references.length === 0) throw new Error(UNAVAILABLE);
  const remoteEnvironmentId = references[0].environmentId;
  if (
    references.some(
      (reference) => reference.environmentId !== remoteEnvironmentId,
    )
  ) {
    throw new Error("Files can only be copied or moved within one machine.");
  }
  if (remoteEnvironmentId.startsWith("voktty-ssh-")) {
    return runNativeProfileCommand(
      command,
      args,
      references,
      remoteEnvironmentId,
    );
  }

  let environmentId: string | undefined;
  const toHost = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(toHost);
    if (typeof value !== "string") return value;
    const parsed = parseRemotePath(value);
    if (!parsed || (environmentId && parsed.environmentId !== environmentId))
      throw new Error("Files can only be copied or moved within one machine.");
    environmentId = parsed.environmentId;
    return parsed.hostPath;
  };
  const hostArgs = Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      PATH_ARGS.includes(key)
        ? toHost(value)
        : key === "options" &&
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
          ? { ...value, cwd: toHost((value as Record<string, unknown>).cwd) }
          : value,
    ]),
  );
  if (!environmentId) throw new Error(UNAVAILABLE);
  const env = environmentId;
  const machine = await remoteMachineFor(env);
  if (!machine)
    throw new Error("This project’s machine isn’t connected on this computer.");
  let result: unknown;
  try {
    result = await remoteRequest(machine.id, "workspace.run", {
      command,
      args: hostArgs,
    });
  } catch (reason) {
    if (/Unsupported (host method|remote operation)/i.test(String(reason)))
      throw new Error(OUTDATED);
    throw reason;
  }
  const fromHost = (path: string) => remotePath(env, path);
  if (PATH_RESULTS.has(command) && typeof result === "string")
    return fromHost(result);
  if (ENTRY_RESULTS.has(command) && Array.isArray(result))
    return result.map((entry: { path: string }) => ({
      ...entry,
      path: fromHost(entry.path),
    }));
  if (
    (command === "git_diff_index" || command === "git_diff_files") &&
    result &&
    typeof result === "object"
  ) {
    const index = result as { files: { path: string }[] };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return {
      ...index,
      files: index.files.map((file) => ({
        ...file,
        path: fromHost(`${root}/${file.path}`),
      })),
    };
  }
  if (command === "git_file_diff" && result && typeof result === "object") {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "git_commit_files" && Array.isArray(result)) {
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return result.map((file: { path: string }) => ({
      ...file,
      path: fromHost(`${root}/${file.path}`),
    }));
  }
  if (
    command === "git_commit_file_diff" &&
    result &&
    typeof result === "object"
  ) {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "search_project" && result && typeof result === "object") {
    const search = result as { matches: { path: string }[] };
    return {
      ...search,
      matches: search.matches.map((match) => ({
        ...match,
        path: fromHost(match.path),
      })),
    };
  }
  if (command === "git_worktrees" && result && typeof result === "object") {
    const worktrees = result as {
      defaultRoot: string;
      worktrees: { path: string }[];
    };
    return {
      ...worktrees,
      defaultRoot: fromHost(worktrees.defaultRoot),
      worktrees: worktrees.worktrees.map((tree) => ({
        ...tree,
        path: fromHost(tree.path),
      })),
    };
  }
  return result;
}

setRemoteCommandRunner(runRemoteCommand);
