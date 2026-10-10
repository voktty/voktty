import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");
const MANIFEST_PATH = join(REPO_ROOT, "integrations/monocode-010/ports.json");

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitPaths(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function resolveCommit(root, ref) {
  return git(root, "rev-parse", "--verify", `${ref}^{commit}`);
}

function commitPaths(root, sha) {
  const firstParent = git(root, "rev-parse", `${sha}^1`);
  return new Set(
    gitPaths(
      root,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      firstParent,
      sha,
    ),
  );
}

function treePaths(root, sha) {
  return new Set(gitPaths(root, "ls-tree", "-r", "--name-only", "-z", sha));
}

function assertPathSet(paths, expected, context) {
  for (const path of expected) {
    if (!paths.has(path)) throw new Error(`${context} does not contain ${path}`);
  }
}

function relativePath(path, label) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\0") ||
    path.startsWith("-") ||
    path.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  return path;
}

export function verifyPorts({ upstream, localRoot, manifest }) {
  const base = resolveCommit(upstream, manifest.upstreamBase);
  const target = resolveCommit(upstream, manifest.upstreamTarget);
  const localBaseline = resolveCommit(localRoot, manifest.localBaseline);
  const upstreamTargetPaths = treePaths(upstream, target);
  const upstreamLicense = git(upstream, "show", `${target}:LICENSE`);
  const upstreamRange = new Set(
    git(upstream, "rev-list", `${base}..${target}`).split("\n").filter(Boolean),
  );
  const localHead = resolveCommit(localRoot, "HEAD");
  const localBaselinePaths = treePaths(localRoot, localBaseline);
  const localHeadPaths = treePaths(localRoot, localHead);
  const records = [];

  for (const record of manifest.records) {
    const upstreamCommit = resolveCommit(upstream, record.upstreamCommit);
    const localCommitRefs = record.localCommits ?? [record.localCommit];
    if (
      !Array.isArray(localCommitRefs) ||
      localCommitRefs.length === 0 ||
      localCommitRefs.some((commit) => typeof commit !== "string") ||
      new Set(localCommitRefs).size !== localCommitRefs.length
    ) {
      throw new Error(`Invalid local commit list for ${record.upstreamCommit}`);
    }
    const localCommits = localCommitRefs.map((commit) =>
      resolveCommit(localRoot, commit),
    );
    const localCommit = localCommits.at(-1);
    const defaultBasis = record.basis ?? "integrated";
    if (!["integrated", "preexisting"].includes(defaultBasis)) {
      throw new Error(`Invalid port basis for ${record.upstreamCommit}`);
    }
    const localCommitBases = record.localCommitBases ?? localCommits.map(() => defaultBasis);
    if (
      !Array.isArray(localCommitBases) ||
      localCommitBases.length !== localCommits.length ||
      localCommitBases.some((basis) => !["integrated", "preexisting"].includes(basis))
    ) {
      throw new Error(`Invalid local commit bases for ${record.upstreamCommit}`);
    }
    const basis = new Set(localCommitBases).size === 1 ? localCommitBases[0] : "mixed";
    if (!upstreamRange.has(upstreamCommit)) {
      throw new Error(`Upstream commit is outside the pinned range: ${upstreamCommit}`);
    }
    if (!upstreamCommit.startsWith(record.upstreamCommit)) {
      throw new Error(`Upstream commit does not match the manifest: ${record.upstreamCommit}`);
    }
    if (
      record.localCommit &&
      (localCommits.length !== 1 || !localCommit.startsWith(record.localCommit))
    ) {
      throw new Error(`Local commit does not match the manifest: ${record.localCommit}`);
    }
    if (git(upstream, "show", "-s", "--format=%s", upstreamCommit) !== record.upstreamTitle) {
      throw new Error(`Upstream title changed for ${record.upstreamCommit}`);
    }

    const upstreamChanged = commitPaths(upstream, upstreamCommit);
    const localChanged = new Set();
    const preexistingLocalChanged = new Set();
    const localTree = new Set();
    for (const [index, commit] of localCommits.entries()) {
      const commitBasis = localCommitBases[index];
      for (const path of commitPaths(localRoot, commit)) {
        localChanged.add(path);
        if (commitBasis === "preexisting") preexistingLocalChanged.add(path);
      }
      for (const path of treePaths(localRoot, commit)) localTree.add(path);
      try {
        if (commitBasis === "preexisting") {
          git(localRoot, "merge-base", "--is-ancestor", commit, localBaseline);
          git(localRoot, "merge-base", "--is-ancestor", localBaseline, localHead);
        } else {
          git(localRoot, "merge-base", "--is-ancestor", localBaseline, commit);
          git(localRoot, "merge-base", "--is-ancestor", commit, localHead);
        }
      } catch {
        const history =
          commitBasis === "preexisting"
            ? "the pinned preexisting history"
            : "the pinned integration history";
        throw new Error(`Local port commit is outside ${history}: ${commit}`);
      }
    }
    const coverage = record.coverage ?? "complete";
    const deferred = record.deferred ?? [];
    if (
      !["complete", "partial"].includes(coverage) ||
      !Array.isArray(deferred) ||
      deferred.some((item) => typeof item !== "string" || item.trim() === "") ||
      (coverage === "partial" && deferred.length === 0) ||
      (coverage === "complete" && deferred.length > 0)
    ) {
      throw new Error(`Invalid coverage details for ${record.upstreamCommit}`);
    }
    const expectedLocalPaths = [];
    for (const mapping of record.mappings) {
      const upstreamPath = relativePath(mapping.upstream, "Mapped upstream path");
      const localPath = relativePath(mapping.local, "Mapped local path");
      assertPathSet(upstreamChanged, [upstreamPath], `Upstream commit ${record.upstreamCommit}`);
      assertPathSet(upstreamTargetPaths, [upstreamPath], `Upstream target tree ${target}`);
      assertPathSet(localChanged, [localPath], `Local port commits for ${record.upstreamCommit}`);
      assertPathSet(localTree, [localPath], `Local port commit trees for ${record.upstreamCommit}`);
      if (preexistingLocalChanged.has(localPath)) {
        assertPathSet(localBaselinePaths, [localPath], "Pinned local baseline tree");
      }
      assertPathSet(localHeadPaths, [localPath], "Current local tree");
      expectedLocalPaths.push(localPath);
    }

    const tests = [];
    for (const test of record.tests) {
      const files = test.files.map((path) => relativePath(path, "Test path"));
      assertPathSet(localChanged, files, `Local port commits for ${record.upstreamCommit}`);
      assertPathSet(localTree, files, `Local port commit trees for ${record.upstreamCommit}`);
      for (const file of files) {
        if (preexistingLocalChanged.has(file)) {
          assertPathSet(localBaselinePaths, [file], "Pinned local baseline tree");
        }
      }
      assertPathSet(localHeadPaths, files, "Current local tree");
      if (test.runner === "vitest") {
        if (test.cwd !== "." || files.length === 0 || files.some((path) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path))) {
          throw new Error(`Invalid Vitest configuration for ${record.upstreamCommit}`);
        }
      } else if (test.runner === "cargo-nextest") {
        if (
          test.cwd !== "src-tauri" ||
          typeof test.filter !== "string" ||
          !/^[A-Za-z0-9_:]+$/.test(test.filter) ||
          files.some((path) => !path.endsWith(".rs"))
        ) {
          throw new Error(`Invalid nextest configuration for ${record.upstreamCommit}`);
        }
      } else {
        throw new Error(`Unsupported test runner for ${record.upstreamCommit}`);
      }
      const cwd = relativePath(test.cwd ?? ".", "Test working directory");
      tests.push({ cwd, runner: test.runner, filter: test.filter, files });
      expectedLocalPaths.push(...files);
    }

    if (
      record.license !== "MIT" ||
      !upstreamLicense.startsWith("MIT License") ||
      !record.rationale
    ) {
      throw new Error(`License and rationale are required for ${record.upstreamCommit}`);
    }
    records.push({
      upstreamCommit,
      upstreamTitle: record.upstreamTitle,
      localCommit,
      localCommits,
      localCommitBases,
      basis,
      license: record.license,
      coverage,
      deferred,
      mappings: record.mappings,
      tests,
      rationale: record.rationale,
      localPaths: [...new Set(expectedLocalPaths)].sort(),
    });
  }

  return { upstream: { base, target }, localBaseline, records };
}

export function runPortTests(records, localRoot) {
  let count = 0;
  for (const record of records) {
    for (const test of record.tests) {
      const cwd = resolve(localRoot, test.cwd);
      const command =
        test.runner === "vitest"
          ? ["pnpm", "exec", "vitest", "run", ...test.files]
          : ["cargo", "nextest", "run", "--locked", test.filter];
      process.stdout.write(`\n${record.upstreamCommit.slice(0, 8)}: ${command.join(" ")}\n`);
      const result = spawnSync(command[0], command.slice(1), {
        cwd,
        stdio: "inherit",
        timeout: 10 * 60 * 1000,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`Test command failed with status ${result.status ?? "unknown"}`);
      }
      count += 1;
    }
  }
  return count;
}

function parseArgs(args) {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const options = args.filter((arg) => arg.startsWith("--"));
  if (
    positional.length !== 1 ||
    options.length > 1 ||
    options.some((option) => option !== "--run-tests")
  ) {
    throw new Error(
      "Usage: node scripts/monocode/verify-ports.mjs <upstream-repository> [--run-tests]",
    );
  }
  return { upstream: resolve(positional[0]), runTests: options.includes("--run-tests") };
}

function main(args) {
  const { upstream, runTests } = parseArgs(args);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const verification = verifyPorts({ upstream, localRoot: REPO_ROOT, manifest });
  const testsRun = runTests ? runPortTests(verification.records, REPO_ROOT) : 0;
  process.stdout.write(
    `${JSON.stringify(
      {
        upstreamCommits: verification.records.length,
        mappings: verification.records.reduce((total, record) => total + record.mappings.length, 0),
        testCommands: runTests ? testsRun : 0,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
