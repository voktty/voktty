import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targets = [
  {
    selection: "windows",
    platform: "windows-latest",
    args: "",
    "rust-target": "",
    "apple-signing-identity": "",
  },
  {
    selection: "linux",
    platform: "ubuntu-22.04",
    args: "",
    "rust-target": "",
    "apple-signing-identity": "",
  },
  {
    selection: "macos_arm64",
    platform: "macos-latest",
    args: "--target aarch64-apple-darwin",
    "rust-target": "aarch64-apple-darwin",
    "apple-signing-identity": "-",
  },
  {
    selection: "macos_intel",
    platform: "macos-latest",
    args: "--target x86_64-apple-darwin",
    "rust-target": "x86_64-apple-darwin",
    "apple-signing-identity": "-",
  },
];
const internalCrates = new Set([
  "voktty",
  "voktty-aliases",
  "voktty-cli",
  "voktty-collab-protocol",
  "voktty-companion-protocol",
  "voktty-control-protocol",
  "voktty-remote",
  "voktty-remote-protocol",
  "voktty-tool-policy",
  "voktty-workspace-edit",
]);

function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Manual releases require a stable version such as 1.2.3.");
  const parts = version.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error("Version is too large.");
  return parts;
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

export function releasePlan({ eventName, ref, sourceVersion, inputs = {} }) {
  const manual = eventName === "workflow_dispatch";
  if (manual && ref !== "refs/heads/main")
    throw new Error("Manual releases must run from main.");
  const version = manual
    ? inputs.version?.trim()
    : ref.replace(/^refs\/tags\/v/, "");
  if (manual) {
    if (compareVersions(version, sourceVersion) < 0)
      throw new Error("Release version cannot precede the source version.");
  } else if (eventName !== "push" || ref !== `refs/tags/v${sourceVersion}`) {
    throw new Error("Release tag and source versions must match.");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("A semantic version is required.");
  const include = targets.filter(
    (target) => !manual || inputs[target.selection] === true,
  );
  if (include.length === 0)
    throw new Error("Select at least one desktop platform.");
  const latest = manual ? inputs.make_latest === true : !version.includes("-");
  if (latest && include.length !== targets.length)
    throw new Error(
      "Updater latest requires all desktop platforms. Publish a selective release without make_latest.",
    );
  return {
    version,
    tag: `v${version}`,
    matrix: { include },
    latest,
    prerelease: version.includes("-"),
  };
}

export function requireGreenMain(runs, sha) {
  const latest = runs
    .filter(
      (run) =>
        run.head_sha === sha &&
        run.head_branch === "main" &&
        run.event === "push",
    )
    .sort(
      (a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt,
    )[0];
  if (latest?.status !== "completed" || latest?.conclusion !== "success")
    throw new Error(
      `main commit ${sha} needs a successful completed CI run before publication.`,
    );
  return latest.html_url;
}

export function versionUpdates(files, target) {
  const current = JSON.parse(files["package.json"]).version;
  const tauri = JSON.parse(files["src-tauri/tauri.conf.json"]);
  if (tauri.version !== current)
    throw new Error("Package and Tauri versions differ.");
  const cargo = files["src-tauri/Cargo.toml"];
  const replacements = new Map(Object.entries(files));
  let sections = 0;
  replacements.set(
    "src-tauri/Cargo.toml",
    cargo.replace(
      /(\[(?:package|workspace\.package)\][\s\S]*?^version\s*=\s*")([^"]+)(")/gm,
      (_, start, version, end) => {
        if (version !== current)
          throw new Error("Cargo versions differ from package.json.");
        sections++;
        return `${start}${target}${end}`;
      },
    ),
  );
  if (sections !== 2)
    throw new Error("Expected package and workspace Cargo versions.");
  const found = new Set();
  replacements.set(
    "src-tauri/Cargo.lock",
    files["src-tauri/Cargo.lock"]
      .split("[[package]]")
      .map((block) => {
        const name = block.match(/^name = "([^"]+)"/m)?.[1];
        if (!internalCrates.has(name)) return block;
        if (found.has(name) || /^source = /m.test(block))
          throw new Error(`Unexpected lock entry for ${name}.`);
        if (!/^version = "[^"]+"/m.test(block))
          throw new Error(`Lock version missing for ${name}.`);
        found.add(name);
        return block.replace(/^version = "([^"]+)"/m, (_, version) => {
          if (version !== current)
            throw new Error(`Lock version differs for ${name}.`);
          return `version = "${target}"`;
        });
      })
      .join("[[package]]"),
  );
  if (found.size !== internalCrates.size)
    throw new Error("Internal crates missing from Cargo.lock.");
  if (current === target) return {};
  if (compareVersions(target, current) < 0)
    throw new Error("Release version cannot decrease.");
  for (const path of ["package.json", "src-tauri/tauri.conf.json"])
    replacements.set(
      path,
      files[path].replace(
        /("version"\s*:\s*")[^"]+("\s*[,}])/,
        (_, start, end) => `${start}${target}${end}`,
      ),
    );
  return Object.fromEntries(replacements);
}

export function verifyUpdaterManifest(manifest, plan, repository) {
  if (
    manifest.version !== plan.version ||
    !manifest.platforms ||
    typeof manifest.platforms !== "object"
  )
    throw new Error("Updater manifest does not match the release version.");
  const prefixes = {
    windows: "windows-x86_64",
    linux: "linux-x86_64",
    macos_arm64: "darwin-aarch64",
    macos_intel: "darwin-x86_64",
  };
  const entries = Object.entries(manifest.platforms);
  for (const target of plan.matrix.include) {
    const prefix = prefixes[target.selection];
    if (
      !prefix ||
      !entries.some(([key]) => key === prefix || key.startsWith(`${prefix}-`))
    )
      throw new Error(`Updater manifest is missing ${target.selection}.`);
  }
  const expectedUrl = `https://github.com/${repository}/releases/download/${plan.tag}/`;
  for (const [, entry] of entries) {
    if (
      typeof entry.signature !== "string" ||
      !entry.signature.trim() ||
      typeof entry.url !== "string" ||
      !entry.url.startsWith(expectedUrl)
    )
      throw new Error(
        "Updater entry has no signature or points outside this release.",
      );
  }
}

export function applyVersion(root, version) {
  const paths = [
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ];
  const files = Object.fromEntries(
    paths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
  );
  const updates = versionUpdates(files, version);
  for (const [path, content] of Object.entries(updates))
    writeFileSync(resolve(root, path), content);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error("Usage: node scripts/release/desktop-release.mjs VERSION");
  applyVersion(process.cwd(), process.argv[2]);
}
