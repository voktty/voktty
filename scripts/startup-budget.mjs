import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function htmlResources(html) {
  const resources = [];
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    const isScript = lower.startsWith("<script");
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const tracked =
      isScript || rel.includes("stylesheet") || rel.includes("modulepreload");
    if (!tracked) continue;
    const asset = attribute(tag, isScript ? "src" : "href");
    if (asset) resources.push(asset);
  }
  return resources;
}

function outputAsset(outputDir, htmlPath, reference) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//")) {
    return null;
  }
  const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  const candidate = resolve(
    reference.startsWith("/") ? outputDir : dirname(htmlPath),
    reference.startsWith("/") ? `.${pathname}` : pathname,
  );
  const rel = relative(outputDir, candidate);
  if (rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error(`Startup asset escapes output directory: ${reference}`);
  }
  return candidate;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function violationsFor(entry, result) {
  const violations = [];
  if (entry.maxResources !== undefined && result.resources.length > entry.maxResources) {
    violations.push(
      `${entry.html}: ${result.resources.length} resources exceeds ${entry.maxResources}`,
    );
  }
  if (entry.maxGzipBytes !== undefined && result.gzipBytes > entry.maxGzipBytes) {
    violations.push(
      `${entry.html}: ${formatBytes(result.gzipBytes)} gzip exceeds ${formatBytes(entry.maxGzipBytes)}`,
    );
  }
  for (const pattern of entry.forbiddenAssets ?? []) {
    const matches = result.resources.filter((resource) => resource.path.includes(pattern));
    if (matches.length > 0) {
      violations.push(
        `${entry.html}: forbidden startup asset ${pattern} (${matches.map((item) => item.path).join(", ")})`,
      );
    }
  }
  return violations;
}

export function analyzeStartupEntry(outputDir, entry) {
  const htmlPath = resolve(outputDir, entry.html);
  if (!existsSync(htmlPath)) throw new Error(`Startup HTML does not exist: ${entry.html}`);

  const seen = new Set();
  const externalResources = [];
  const resources = [];
  for (const reference of htmlResources(readFileSync(htmlPath, "utf8"))) {
    const asset = outputAsset(outputDir, htmlPath, reference);
    if (asset === null) {
      externalResources.push(reference);
      continue;
    }
    const path = relative(outputDir, asset).replaceAll("\\", "/");
    if (seen.has(path)) continue;
    seen.add(path);
    if (!existsSync(asset) || !statSync(asset).isFile()) {
      throw new Error(`Startup asset does not exist: ${path}`);
    }
    const content = readFileSync(asset);
    resources.push({ path, bytes: content.length, gzipBytes: gzipSync(content).length });
  }

  const rawBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
  const gzipBytes = resources.reduce(
    (total, resource) => total + resource.gzipBytes,
    0,
  );
  return {
    html: entry.html,
    resources,
    externalResources,
    rawBytes,
    gzipBytes,
    topResources: [...resources].sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 10),
  };
}

export function checkStartupBudget(config, outputDir = resolve(root, "dist")) {
  const results = config.entries.map((entry) => analyzeStartupEntry(outputDir, entry));
  const violations = results.flatMap((result, index) =>
    violationsFor(config.entries[index], result),
  );
  if (violations.length > 0) {
    throw new Error(`Startup budget violations:\n${violations.join("\n")}`);
  }
  return results;
}

function printResult(result) {
  console.log(
    `${result.html}: ${result.resources.length} resources, ${formatBytes(result.rawBytes)} raw, ${formatBytes(result.gzipBytes)} gzip`,
  );
  for (const resource of result.topResources) {
    console.log(`  ${resource.path}: ${formatBytes(resource.gzipBytes)} gzip`);
  }
  for (const external of result.externalResources) {
    console.log(`  external resource: ${external}`);
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const configPath = resolve(root, process.argv[2] ?? "scripts/startup-budget.config.json");
  const outputDir = resolve(root, process.argv[3] ?? "dist");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  for (const result of checkStartupBudget(config, outputDir)) printResult(result);
}
