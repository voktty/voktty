import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, it } from "node:test";
import { verifyPorts } from "./verify-ports.mjs";

const temp = mkdtempSync(join(tmpdir(), "monocode-port-proof-test-"));
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
  git(root, "config", "user.name", "Port Proof Test");
  git(root, "config", "user.email", "port-proof@example.invalid");
}

function commit(root, message) {
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

it("verifies mapped upstream and local changes with test paths", () => {
  const upstream = join(temp, "upstream");
  const local = join(temp, "local");
  initRepo(upstream);
  initRepo(local);

  writeFileSync(join(upstream, "README.md"), "base\n");
  writeFileSync(join(upstream, "LICENSE"), "MIT License\n");
  const upstreamBase = commit(upstream, "Base");
  mkdirSync(join(upstream, "src/features"), { recursive: true });
  writeFileSync(join(upstream, "src/features/codex.ts"), "export const updated = true;\n");
  const upstreamCommit = commit(upstream, "Update Codex behavior");
  const upstreamTarget = upstreamCommit;

  writeFileSync(join(local, "README.md"), "base\n");
  const localBaseline = commit(local, "Local baseline");
  mkdirSync(join(local, "src/modules/harness"), { recursive: true });
  writeFileSync(join(local, "src/modules/harness/codex.ts"), "export const updated = true;\n");
  writeFileSync(join(local, "src/modules/harness/codex.test.ts"), "test\n");
  const localCommit = commit(local, "Port Codex behavior");

  const manifest = {
    upstreamBase,
    upstreamTarget,
    localBaseline,
    records: [
      {
        upstreamCommit,
        upstreamTitle: "Update Codex behavior",
        localCommit,
        license: "MIT",
        coverage: "partial",
        deferred: ["A host-specific behavior remains to be reviewed."],
        mappings: [
          {
            upstream: "src/features/codex.ts",
            local: "src/modules/harness/codex.ts",
          },
        ],
        tests: [
          {
            files: ["src/modules/harness/codex.test.ts"],
            cwd: ".",
            runner: "vitest",
          },
        ],
        rationale: "Preserve the provider behavior in the local Harness architecture.",
      },
    ],
  };

  const result = verifyPorts({ upstream, localRoot: local, manifest });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].coverage, "partial");
  assert.deepEqual(result.records[0].deferred, [
    "A host-specific behavior remains to be reviewed.",
  ]);
  assert.deepEqual(result.records[0].localPaths, [
    "src/modules/harness/codex.test.ts",
    "src/modules/harness/codex.ts",
  ]);

  manifest.records.push(JSON.parse(JSON.stringify(manifest.records[0])));
  assert.throws(
    () => verifyPorts({ upstream, localRoot: local, manifest }),
    /Duplicate upstream port record/,
  );
  manifest.records.pop();

  delete manifest.records[0].coverage;
  delete manifest.records[0].deferred;
  assert.equal(verifyPorts({ upstream, localRoot: local, manifest }).records[0].coverage, "complete");

  manifest.records[0].coverage = "unknown";
  assert.throws(
    () => verifyPorts({ upstream, localRoot: local, manifest }),
    /Invalid coverage details/,
  );

  delete manifest.records[0].coverage;
  manifest.records[0].mappings[0].local = "src/modules/harness/missing.ts";
  assert.throws(
    () => verifyPorts({ upstream, localRoot: local, manifest }),
    /does not contain src\/modules\/harness\/missing\.ts/,
  );
});

it("verifies a port whose mappings and tests span local commits", () => {
  const upstream = join(temp, "upstream-multi");
  const local = join(temp, "local-multi");
  initRepo(upstream);
  initRepo(local);

  writeFileSync(join(upstream, "README.md"), "base\n");
  writeFileSync(join(upstream, "LICENSE"), "MIT License\n");
  const upstreamBase = commit(upstream, "Base");
  mkdirSync(join(upstream, "src"), { recursive: true });
  writeFileSync(join(upstream, "src/first.ts"), "export const first = true;\n");
  writeFileSync(join(upstream, "src/second.ts"), "export const second = true;\n");
  const upstreamCommit = commit(upstream, "Improve two behaviors");

  writeFileSync(join(local, "README.md"), "base\n");
  const localBaseline = commit(local, "Local baseline");
  mkdirSync(join(local, "src/modules/harness"), { recursive: true });
  writeFileSync(join(local, "src/modules/harness/first.ts"), "export const first = true;\n");
  writeFileSync(join(local, "src/modules/harness/first.test.ts"), "test first\n");
  const firstCommit = commit(local, "Port first behavior");
  writeFileSync(join(local, "src/modules/harness/second.ts"), "export const second = true;\n");
  writeFileSync(join(local, "src/modules/harness/second.test.ts"), "test second\n");
  const secondCommit = commit(local, "Port second behavior");

  const manifest = {
    upstreamBase,
    upstreamTarget: upstreamCommit,
    localBaseline,
    records: [
      {
        upstreamCommit,
        upstreamTitle: "Improve two behaviors",
        localCommits: [firstCommit, secondCommit],
        license: "MIT",
        mappings: [
          { upstream: "src/first.ts", local: "src/modules/harness/first.ts" },
          { upstream: "src/second.ts", local: "src/modules/harness/second.ts" },
        ],
        tests: [
          {
            files: ["src/modules/harness/first.test.ts", "src/modules/harness/second.test.ts"],
            cwd: ".",
            runner: "vitest",
          },
        ],
        rationale: "A larger upstream change was adapted across focused local commits.",
      },
    ],
  };

  const result = verifyPorts({ upstream, localRoot: local, manifest });
  assert.deepEqual(result.records[0].localCommits, [firstCommit, secondCommit]);
  assert.equal(result.records[0].mappings.length, 2);
});

it("verifies behavior adapted before the pinned local baseline", () => {
  const upstream = join(temp, "upstream-preexisting");
  const local = join(temp, "local-preexisting");
  initRepo(upstream);
  initRepo(local);

  writeFileSync(join(upstream, "README.md"), "base\n");
  writeFileSync(join(upstream, "LICENSE"), "MIT License\n");
  const upstreamBase = commit(upstream, "Base");
  mkdirSync(join(upstream, "src/features"), { recursive: true });
  writeFileSync(join(upstream, "src/features/codex.ts"), "export const updated = true;\n");
  const upstreamCommit = commit(upstream, "Update Codex behavior");

  writeFileSync(join(local, "README.md"), "base\n");
  const localRootCommit = commit(local, "Local root");
  mkdirSync(join(local, "src/modules/harness"), { recursive: true });
  writeFileSync(join(local, "src/modules/harness/codex.ts"), "export const updated = true;\n");
  writeFileSync(join(local, "src/modules/harness/codex.test.ts"), "test\n");
  const preexistingCommit = commit(local, "Adapt Codex behavior");
  writeFileSync(join(local, "README.md"), "baseline\n");
  const localBaseline = commit(local, "Pin local baseline");
  writeFileSync(join(local, "src/modules/harness/codex.ts"), "export const updated = true;\n// adapted\n");
  writeFileSync(join(local, "src/modules/harness/codex.test.ts"), "test\n// prefetch coverage\n");
  const integratedCommit = commit(local, "Complete Inbox prefetch adaptation");

  const manifest = {
    upstreamBase,
    upstreamTarget: upstreamCommit,
    localBaseline,
    records: [
      {
        upstreamCommit,
        upstreamTitle: "Update Codex behavior",
        localCommits: [preexistingCommit, integratedCommit],
        localCommitBases: ["preexisting", "integrated"],
        license: "MIT",
        mappings: [
          {
            upstream: "src/features/codex.ts",
            local: "src/modules/harness/codex.ts",
          },
        ],
        tests: [
          {
            files: ["src/modules/harness/codex.test.ts"],
            cwd: ".",
            runner: "vitest",
          },
        ],
        rationale: "The behavior was adapted before this integration range.",
      },
    ],
  };

  const result = verifyPorts({ upstream, localRoot: local, manifest });
  assert.equal(result.records[0].basis, "mixed");
  assert.deepEqual(result.records[0].localCommitBases, ["preexisting", "integrated"]);
  assert.deepEqual(result.records[0].localCommits, [preexistingCommit, integratedCommit]);

  manifest.localBaseline = localRootCommit;
  assert.throws(
    () => verifyPorts({ upstream, localRoot: local, manifest }),
    /outside the pinned preexisting history/,
  );
});

it("verifies merge coverage against individually ported side commits", () => {
  const upstream = join(temp, "upstream-merge");
  const local = join(temp, "local-merge");
  initRepo(upstream);
  initRepo(local);

  writeFileSync(join(upstream, "README.md"), "base\n");
  writeFileSync(join(upstream, "LICENSE"), "MIT License\n");
  const upstreamBase = commit(upstream, "Base");
  git(upstream, "checkout", "--quiet", "-b", "feature");
  mkdirSync(join(upstream, "src/features"), { recursive: true });
  writeFileSync(join(upstream, "src/features/codex.ts"), "export const updated = true;\n");
  const upstreamPort = commit(upstream, "Update Codex behavior");
  git(upstream, "checkout", "--quiet", "-b", "mainline", upstreamBase);
  writeFileSync(join(upstream, "docs.md"), "mainline change\n");
  commit(upstream, "Update docs");
  execFileSync("git", ["-C", upstream, "merge", "--no-ff", "--quiet", "feature", "-m", "Merge feature"]);
  const upstreamMerge = git(upstream, "rev-parse", "HEAD");

  writeFileSync(join(local, "README.md"), "base\n");
  const localBaseline = commit(local, "Local baseline");
  mkdirSync(join(local, "src/modules/harness"), { recursive: true });
  writeFileSync(join(local, "src/modules/harness/codex.ts"), "export const updated = true;\n");
  const localPort = commit(local, "Port Codex behavior");

  const manifest = {
    upstreamBase,
    upstreamTarget: upstreamMerge,
    localBaseline,
    records: [
      {
        upstreamCommit: upstreamPort,
        upstreamTitle: "Update Codex behavior",
        localCommit: localPort,
        license: "MIT",
        mappings: [
          { upstream: "src/features/codex.ts", local: "src/modules/harness/codex.ts" },
        ],
        tests: [],
        rationale: "The provider behavior was adapted in the Harness.",
      },
    ],
    mergeCoverage: [
      {
        upstreamCommit: upstreamMerge,
        upstreamTitle: "Merge feature",
        coveredBy: [upstreamPort],
        rationale: "The merge contains only behavior from the separately ported feature commit.",
      },
    ],
  };

  const result = verifyPorts({ upstream, localRoot: local, manifest });
  assert.equal(result.mergeCoverage.length, 1);
  assert.deepEqual(result.mergeCoverage[0].coveredBy, [upstreamPort]);

  manifest.mergeCoverage[0].coveredBy = [];
  assert.throws(
    () => verifyPorts({ upstream, localRoot: local, manifest }),
    /Invalid merge coverage details/,
  );
});
