import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, it } from "node:test";
import { buildInventory, inventorySummary, renderMarkdown } from "./audit.mjs";

const temp = mkdtempSync(join(tmpdir(), "monocode-audit-test-"));
after(() => rmSync(temp, { recursive: true, force: true }));

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initRepo(root) {
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  git(root, "config", "user.name", "Audit Test");
  git(root, "config", "user.email", "audit@example.invalid");
}

function commit(root, message) {
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

it("builds a stable inventory from pinned Git objects without changing either worktree", () => {
  const upstream = join(temp, "upstream");
  const local = join(temp, "local");
  initRepo(upstream);
  initRepo(local);

  const upstreamFile = join(upstream, "src/features/shared.ts");
  mkdirSync(join(upstream, "src/features"), { recursive: true });
  writeFileSync(upstreamFile, "export const value = 'old';\n");
  writeFileSync(
    join(upstream, "src/features/codex.ts"),
    "import Base from 'mono';\nexport const unchanged = true;\n",
  );
  const base = commit(upstream, "Add shared helper");

  writeFileSync(upstreamFile, "export const value = 'new';\n");
  writeFileSync(
    join(upstream, "src/features/codex.ts"),
    "import Upstream from 'mono';\nexport const unchanged = true;\n",
  );
  writeFileSync(join(upstream, "src/features/added.ts"), "export const added = true;\n");
  const target = commit(upstream, "Update helper and add file");

  const localFile = join(local, "src/modules/harness/shared.ts");
  mkdirSync(join(local, "src/modules/harness"), { recursive: true });
  writeFileSync(localFile, "export const value = 'new';\n");
  const localProofFile = join(local, "src/modules/harness/codex.ts");
  writeFileSync(
    localProofFile,
    "import Local from 'local';\nexport const unchanged = true;\n",
  );
  const localBaseline = commit(local, "Capture local baseline");
  writeFileSync(localFile, "changed after baseline\n");

  const upstreamStatus = git(upstream, "status", "--porcelain");
  const localStatus = git(local, "status", "--porcelain");
  const inventory = buildInventory({
    upstream,
    localRoot: local,
    baseRef: base,
    targetRef: target,
    localRef: localBaseline,
    proofFiles: ["codex.ts"],
  });

  assert.deepEqual(inventorySummary(inventory), {
    commits: 1,
    files: 3,
    comparison: { no_candidate: 1, different: 1, identical: 1 },
  });
  assert.deepEqual(inventory.files["src/features/shared.ts"], {
    candidates: ["src/modules/harness/shared.ts"],
    comparison: "identical",
  });
  assert.equal(inventory.merge_proof[0].raw.conflicts, 1);
  assert.equal(inventory.merge_proof[0].without_imports_branding.conflicts, 0);
  assert.match(renderMarkdown(inventory), /Update helper and add file/);
  assert.equal(git(upstream, "status", "--porcelain"), upstreamStatus);
  assert.equal(git(local, "status", "--porcelain"), localStatus);
  assert.equal(readFileSync(localFile, "utf8"), "changed after baseline\n");
  assert.equal(readFileSync(localProofFile, "utf8"), "import Local from 'local';\nexport const unchanged = true;\n");
});

it("lists merge commit paths relative to the first parent", () => {
  const upstream = join(temp, "merge-upstream");
  const local = join(temp, "merge-local");
  initRepo(upstream);
  initRepo(local);

  writeFileSync(join(upstream, "README.md"), "base\n");
  const base = commit(upstream, "Base");
  git(upstream, "switch", "--quiet", "-c", "feature");
  mkdirSync(join(upstream, "src/features"), { recursive: true });
  writeFileSync(join(upstream, "src/features/feature.ts"), "export {}\n");
  commit(upstream, "Feature change");
  git(upstream, "switch", "--quiet", "-");
  writeFileSync(join(upstream, "README.md"), "main\n");
  commit(upstream, "Main change");
  git(upstream, "merge", "--quiet", "--no-ff", "--no-edit", "feature");
  const target = git(upstream, "rev-parse", "HEAD");

  mkdirSync(join(local, "src/modules/harness"), { recursive: true });
  writeFileSync(join(local, "src/modules/harness/local.ts"), "export {}\n");
  const localBaseline = commit(local, "Local baseline");
  const inventory = buildInventory({
    upstream,
    localRoot: local,
    baseRef: base,
    targetRef: target,
    localRef: localBaseline,
  });
  const merge = inventory.commits.find((entry) => entry.title.startsWith("Merge"));

  assert.deepEqual(merge?.paths, ["src/features/feature.ts"]);
});
