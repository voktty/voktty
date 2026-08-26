import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const scanRoots = ["src", "src-tauri/src", "src-tauri/crates", "scripts"];
const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".nsh",
  ".ps1",
  ".rs",
  ".ts",
  ".tsx",
]);
const skippedDirectories = new Set([
  ".git",
  "dist",
  "graphify-out",
  "node_modules",
  "PROMPTS",
  "target",
]);
const syntheticAccounts = new Set([
  "aj",
  "developer",
  "devuser",
  "example",
  "example-user",
  "foo",
  "leo",
  "me",
  "u",
  "user",
  "username",
]);
const accountPathPatterns = [
  {
    kind: "Windows profile",
    pattern:
      /[A-Za-z]:[\\/]+Users[\\/]+([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/gi,
  },
  {
    kind: "POSIX home",
    pattern: /\/(?:home|Users)\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g,
  },
];

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...sourceFiles(join(directory, entry.name)));
      }
      continue;
    }
    if (sourceExtensions.has(extname(entry.name))) {
      if (/\.(?:node-)?(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        continue;
      }
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

const findings = [];
for (const scanRoot of scanRoots) {
  const absoluteRoot = resolve(projectRoot, scanRoot);
  for (const file of sourceFiles(absoluteRoot)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      for (const { kind, pattern } of accountPathPatterns) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          const account = match[1].toLowerCase();
          if (syntheticAccounts.has(account)) continue;
          findings.push({
            file: relative(projectRoot, file).replaceAll("\\", "/"),
            line: lineIndex + 1,
            kind,
            account: match[1],
          });
        }
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Account-specific absolute paths found in production sources:");
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line} ${finding.kind} account '${finding.account}'`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("Portable path check passed: no account-specific paths found.");
}
