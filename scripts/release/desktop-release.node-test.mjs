import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareVersions,
  releasePlan,
  requireGreenMain,
  verifyUpdaterManifest,
  versionUpdates,
} from "./desktop-release.mjs";

const sourceVersion = "1.2.3";
const manual = (inputs = {}, ref = "refs/heads/main") =>
  releasePlan({
    eventName: "workflow_dispatch",
    ref,
    sourceVersion,
    inputs: { version: "1.2.4", windows: true, ...inputs },
  });

test("manual Windows release selects only Windows and preserves the global updater channel", () => {
  const plan = manual();
  assert.equal(plan.tag, "v1.2.4");
  assert.equal(plan.latest, false);
  assert.deepEqual(
    plan.matrix.include.map((target) => target.platform),
    ["windows-latest"],
  );
});

test("tag releases select every desktop target and require source version equality", () => {
  const plan = releasePlan({
    eventName: "push",
    ref: "refs/tags/v1.2.3",
    sourceVersion,
  });
  assert.equal(plan.matrix.include.length, 4);
  assert.equal(plan.latest, true);
  assert.throws(() =>
    releasePlan({ eventName: "push", ref: "refs/tags/v1.2.4", sourceVersion }),
  );
});

test("manual releases reject branches, downgrades, malformed versions and empty selections", () => {
  assert.throws(() => manual({}, "refs/heads/feature"));
  for (const version of [
    "1.2.2",
    "v1.2.4",
    "1.2.4-beta",
    "01.2.4",
    "1.2.4\nextra",
  ])
    assert.throws(() => manual({ version }));
  assert.throws(() => manual({ windows: false }));
  assert.throws(() => manual({ make_latest: true }));
  assert.equal(
    manual({
      linux: true,
      macos_arm64: true,
      macos_intel: true,
      make_latest: true,
    }).latest,
    true,
  );
  assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
});

test("only a successful CI run of the exact main push authorizes publication", () => {
  const successful = {
    head_sha: "green",
    head_branch: "main",
    event: "push",
    run_number: 1,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    html_url: "https://example.test/ci",
  };
  assert.equal(requireGreenMain([successful], "green"), successful.html_url);
  assert.throws(() => requireGreenMain([successful], "other"));
  assert.throws(() =>
    requireGreenMain([{ ...successful, head_branch: "feature" }], "green"),
  );
  assert.throws(() =>
    requireGreenMain([{ ...successful, event: "pull_request" }], "green"),
  );
  for (const failure of [
    { status: "in_progress", conclusion: null },
    { status: "completed", conclusion: "failure" },
  ])
    assert.throws(() =>
      requireGreenMain(
        [successful, { ...successful, run_number: 2, ...failure }],
        "green",
      ),
    );
});

const paths = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
const files = Object.fromEntries(
  paths.map((path) => [
    path,
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
  ]),
);

test("build-only version changes keep native metadata and locked internal crates consistent", () => {
  const current = JSON.parse(files["package.json"]).version;
  const parts = current.split(".").map(Number);
  parts[2]++;
  const target = parts.join(".");
  const updated = versionUpdates(files, target);
  assert.equal(JSON.parse(updated["package.json"]).version, target);
  assert.equal(
    JSON.parse(updated["src-tauri/tauri.conf.json"]).version,
    target,
  );
  assert.equal(
    updated["src-tauri/Cargo.toml"].match(
      new RegExp(`^version = "${target.replaceAll(".", "\\.")}"`, "gm"),
    ).length,
    2,
  );
  const before = files["src-tauri/Cargo.lock"].split("[[package]]");
  const after = updated["src-tauri/Cargo.lock"].split("[[package]]");
  assert.equal(before.length, after.length);
  let changed = 0;
  for (let index = 0; index < before.length; index++) {
    if (before[index] === after[index]) continue;
    changed++;
    assert.match(before[index], /^name = "voktty(?:-[^"]+)?"/m);
    assert.equal(
      after[index],
      before[index].replace(`version = "${current}"`, `version = "${target}"`),
    );
  }
  assert.equal(changed, 10);
  assert.deepEqual(versionUpdates(files, current), {});
  const stale = {
    ...files,
    "src-tauri/tauri.conf.json": JSON.stringify({ version: "0.0.1" }),
  };
  assert.throws(() => versionUpdates(stale, target));
  assert.throws(() =>
    versionUpdates(
      {
        ...files,
        "src-tauri/Cargo.lock": files["src-tauri/Cargo.lock"].replace(
          'name = "voktty-cli"',
          'name = "missing-cli"',
        ),
      },
      target,
    ),
  );
});

test("publication requires signed updater entries for the selected platforms and release version", () => {
  const plan = manual();
  const entry = {
    signature: "signed",
    url: "https://github.com/voktty/voktty/releases/download/v1.2.4/installer.exe",
  };
  const manifest = {
    version: plan.version,
    platforms: { "windows-x86_64-nsis": entry },
  };
  verifyUpdaterManifest(manifest, plan, "voktty/voktty");
  assert.throws(() =>
    verifyUpdaterManifest(
      { ...manifest, version: "1.2.3" },
      plan,
      "voktty/voktty",
    ),
  );
  assert.throws(() =>
    verifyUpdaterManifest(
      { ...manifest, platforms: {} },
      plan,
      "voktty/voktty",
    ),
  );
  for (const invalid of [
    { ...entry, signature: "" },
    {
      ...entry,
      url: "https://github.com/voktty/voktty/releases/download/v1.2.3/installer.exe",
    },
  ])
    assert.throws(() =>
      verifyUpdaterManifest(
        { ...manifest, platforms: { "windows-x86_64": invalid } },
        plan,
        "voktty/voktty",
      ),
    );
});
