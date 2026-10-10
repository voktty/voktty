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
