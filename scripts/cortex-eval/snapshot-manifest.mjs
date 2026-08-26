import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "PROMPTS/referencias/cortex");
const excludedDirectories = new Set([".git", "target"]);
const excludedFiles = [/^\$TMPDB4(?:-shm|-wal)?$/, /^cortex-task1-manifest\.json$/];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if (entry.isFile() && excludedFiles.some((pattern) => pattern.test(entry.name))) continue;

    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (entry.isFile()) files.push(path);
  }

  return files;
}

const paths = (await collect(root)).sort((left, right) =>
  relative(root, left).localeCompare(relative(root, right), "en"),
);
const aggregate = createHash("sha256");
const files = [];

for (const path of paths) {
  const content = await readFile(path);
  const metadata = await stat(path);
  const normalizedPath = relative(root, path).split(sep).join("/");
  const sha256 = createHash("sha256").update(content).digest("hex");

  aggregate.update(normalizedPath, "utf8");
  aggregate.update("\0");
  aggregate.update(sha256, "ascii");
  aggregate.update("\0");
  aggregate.update(String(metadata.size), "ascii");
  aggregate.update("\n");
  files.push({ path: normalizedPath, bytes: metadata.size, sha256 });
}

process.stdout.write(
  `${JSON.stringify(
    {
      algorithm: "sha256(path\\0sha256\\0bytes\\n)",
      root: root.split(sep).join("/"),
      fileCount: files.length,
      aggregateSha256: aggregate.digest("hex"),
      exclusions: [".git/", "target/", "$TMPDB4", "$TMPDB4-shm", "$TMPDB4-wal"],
      files,
    },
    null,
    2,
  )}\n`,
);
