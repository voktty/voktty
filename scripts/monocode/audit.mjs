import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const MANIFEST_PATH = join(
  REPO_ROOT,
  "integrations/monocode-010/manifest.json",
);
const OVERRIDES = {
  "src/app/App.tsx": "src/modules/harness/components/HarnessApp.tsx",
  "src-tauri/src/harness.rs": "src-tauri/src/modules/harness/host.rs",
  "src-tauri/src/remote.rs":
    "src-tauri/src/modules/harness/remote_connections.rs",
  "src-tauri/src/harness_updates.rs":
    "src-tauri/src/modules/harness/updates.rs",
  "src/platform/tauri/fs.ts": "src/modules/harness/lib/fs.ts",
  "src/platform/tauri/pty.ts": "src/modules/harness/lib/pty.ts",
};

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitPaths(root, ...args) {
  const result = execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function resolveCommit(root, ref) {
  return git(root, "rev-parse", "--verify", `${ref}^{commit}`).trim();
}

function localPathIndex(root, ref) {
  const paths = gitPaths(
    root,
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    ref,
    "--",
    "src",
    "src-tauri/src",
  );
  const index = new Map();
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const matches = index.get(name) ?? [];
    matches.push(path);
    index.set(name, matches);
  }
  for (const matches of index.values()) matches.sort();
  return index;
}

function candidatesFor(path, index) {
  const override = OVERRIDES[path];
  if (override) {
    const name = override.slice(override.lastIndexOf("/") + 1);
    return (index.get(name) ?? []).includes(override) ? [override] : [];
  }

  const matches = index.get(path.slice(path.lastIndexOf("/") + 1)) ?? [];
  const harnessMatches = matches.filter((candidate) =>
    candidate.includes("/modules/harness/"),
  );
  return harnessMatches.length === 1 ? harnessMatches : matches;
}

function commitCategory(root, sha, paths) {
  const parents = git(root, "rev-list", "--parents", "-n", "1", sha)
    .trim()
    .split(/\s+/)
    .length - 1;
  if (parents > 1) return "merge; review parents";
  if (
    paths.every(
      (path) => !path.startsWith("src/") && !path.startsWith("src-tauri/") && !path.startsWith("host/"),
    )
  )
    return "distribution or documentation";
  if (
    paths.some(
      (path) =>
        path.startsWith("src/features/monos/") ||
        path.startsWith("src/features/artifacts/"),
    )
  )
    return "new product feature; review coexistence";
  return "functional change or adaptation";
}

function commitRows(root, base, target) {
  const rows = git(root, "log", "--reverse", "--format=%H%x09%s", `${base}..${target}`)
    .split("\n")
    .filter(Boolean);
  return rows.map((row) => {
    const separator = row.indexOf("\t");
    const sha = row.slice(0, separator);
    const title = row.slice(separator + 1);
    const firstParent = git(root, "rev-parse", `${sha}^1`).trim();
    const paths = gitPaths(
      root,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      firstParent,
      sha,
    );
    paths.sort();
    return { sha, title, category: commitCategory(root, sha, paths), paths };
  });
}

function readGitFile(root, ref, path) {
  return git(root, "show", `${ref}:${path}`);
}

function adaptedForMerge(text) {
  return text.replace(/^import\b[\s\S]*?;\s*/gm, "").replaceAll("MonoCode", "Voktty");
}

function mergeResult(versions, transformation, directory, filename) {
  const paths = ["local", "base", "upstream"].map((label) => {
    const path = join(directory, `${label}-${filename}`);
    const source = versions[label];
    writeFileSync(path, transformation(source));
    return path;
  });
  const result = spawnSync("git", ["merge-file", "-p", ...paths], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error("git merge-file did not complete");
  return {
    conflicts: (result.stdout.match(/<<<<<<< /g) ?? []).length,
    exit: result.status,
  };
}

function mergeProof({ upstream, localRoot, base, target, local, files, proofFiles }) {
  const proof = [];
  const directory = mkdtempSync(join(tmpdir(), "voktty-monocode-merge-"));
  try {
    for (const name of proofFiles) {
      const paths = Object.keys(files).filter(
        (path) => path.slice(path.lastIndexOf("/") + 1) === name,
      );
      if (paths.length !== 1 || files[paths[0]].candidates.length !== 1) continue;
      const upstreamPath = paths[0];
      const localPath = files[upstreamPath].candidates[0];
      const versions = {
        local: readGitFile(localRoot, local, localPath),
        base: readGitFile(upstream, base, upstreamPath),
        upstream: readGitFile(upstream, target, upstreamPath),
      };
      proof.push({
        upstream: upstreamPath,
        local: localPath,
        raw: mergeResult(versions, (text) => text, directory, name),
        without_imports_branding: mergeResult(versions, adaptedForMerge, directory, name),
      });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return proof;
}

export function buildInventory({
  upstream,
  localRoot,
  baseRef,
  targetRef,
  localRef,
  proofFiles = [],
  scope = "Mechanical commit, path, text-comparison, and isolated merge inventory; it does not certify functional equivalence.",
}) {
  const base = resolveCommit(upstream, baseRef);
  const target = resolveCommit(upstream, targetRef);
  const voktty = resolveCommit(localRoot, localRef);
  const index = localPathIndex(localRoot, voktty);
  const changedPaths = gitPaths(
    upstream,
    "diff",
    "--name-only",
    "-z",
    base,
    target,
  ).sort();
  const upstreamPaths = new Set(
    gitPaths(upstream, "ls-tree", "-r", "--name-only", "-z", target),
  );
  const files = Object.create(null);

  for (const path of changedPaths) {
    const candidates = candidatesFor(path, index);
    let comparison = candidates.length === 0 ? "no_candidate" : "ambiguous";
    if (candidates.length === 1) {
      if (!upstreamPaths.has(path)) {
        comparison = "deleted_upstream";
      } else {
        const upstreamText = readGitFile(upstream, target, path);
        const localText = readGitFile(localRoot, voktty, candidates[0]);
        comparison = localText === upstreamText ? "identical" : "different";
      }
    }
    files[path] = { candidates, comparison };
  }

  return {
    schemaVersion: 1,
    upstream: { base, target },
    vokttyBaseline: voktty,
    scope,
    commits: commitRows(upstream, base, target),
    files,
    merge_proof: mergeProof({
      upstream,
      localRoot,
      base,
      target,
      local: voktty,
      files,
      proofFiles,
    }),
  };
}

function markdownCell(value) {
  return value.replaceAll("|", "/").replace(/[\r\n]+/g, " ");
}

export function renderMarkdown(inventory) {
  const lines = [
    "# MonoCode 0.10 integration inventory",
    "",
    inventory.scope,
    "",
    `Base: \`${inventory.upstream.base}\`. Target: \`${inventory.upstream.target}\`. Voktty baseline: \`${inventory.vokttyBaseline}\`.`,
    "",
    "Same-name candidates and text comparisons are triage only. No candidate does not prove that behavior is absent.",
    "",
    "## Commits",
    "",
    "| SHA | Change | Review category |",
    "| --- | --- | --- |",
  ];

  for (const commit of inventory.commits) {
    lines.push(
      `| \`${commit.sha.slice(0, 8)}\` | ${markdownCell(commit.title)} | ${commit.category} |`,
    );
  }

  lines.push(
    "",
    "## Changed files",
    "",
    "| Upstream path | Local candidates | Text comparison |",
    "| --- | --- | --- |",
  );

  for (const [path, entry] of Object.entries(inventory.files)) {
    const candidates = entry.candidates.length
      ? entry.candidates.map((candidate) => `\`${candidate}\``).join(", ")
      : "none";
    lines.push(
      `| \`${path}\` | ${candidates} | ${entry.comparison} |`,
    );
  }

  lines.push(
    "",
    "## Isolated merge checks",
    "",
    "These textual merge checks do not produce compilable code or establish functional parity.",
    "",
    "| Upstream path | Local path | Raw conflicts | Conflicts after import and branding cleanup |",
    "| --- | --- | ---: | ---: |",
  );
  for (const entry of inventory.merge_proof) {
    lines.push(
      `| \`${entry.upstream}\` | \`${entry.local}\` | ${entry.raw.conflicts} | ${entry.without_imports_branding.conflicts} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function inventorySummary(inventory) {
  const comparison = {};
  for (const { comparison: state } of Object.values(inventory.files)) {
    comparison[state] = (comparison[state] ?? 0) + 1;
  }
  return {
    commits: inventory.commits.length,
    files: Object.keys(inventory.files).length,
    comparison,
  };
}

function parseArgs(args) {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const options = args.filter((arg) => arg.startsWith("--"));
  if (
    positional.length !== 1 ||
    options.length > 1 ||
    options.some((option) => option !== "--check")
  ) {
    throw new Error(
      "Usage: node scripts/monocode/audit.mjs <upstream-repository> [--check]",
    );
  }
  return { upstream: resolve(positional[0]), check: options.includes("--check") };
}

function main(args) {
  const { upstream, check } = parseArgs(args);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const inventory = buildInventory({
    upstream,
    localRoot: REPO_ROOT,
    baseRef: manifest.upstreamBase,
    targetRef: manifest.upstreamTarget,
    localRef: manifest.vokttyBaseline,
    proofFiles: manifest.mergeProofFiles,
    scope: manifest.scope,
  });
  const json = `${JSON.stringify(inventory, null, 2)}\n`;
  const markdown = renderMarkdown(inventory);
  const outputDir = resolve(REPO_ROOT, manifest.outputDirectory);
  const outputs = [
    [join(outputDir, "inventory.json"), json],
    [join(outputDir, "inventory.md"), markdown],
  ];

  if (check) {
    const stale = outputs.filter(
      ([path, content]) => !existsSync(path) || readFileSync(path, "utf8") !== content,
    );
    if (stale.length) {
      throw new Error(
        `Tracked inventory is stale: ${stale.map(([path]) => relative(REPO_ROOT, path)).join(", ")}`,
      );
    }
  } else {
    mkdirSync(outputDir, { recursive: true });
    for (const [path, content] of outputs) writeFileSync(path, content);
  }

  process.stdout.write(`${JSON.stringify(inventorySummary(inventory), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
