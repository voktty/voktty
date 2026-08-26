import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_MODES = new Set([
  "platform",
  "baseline",
  "prepare",
  "ready-sqlite",
  "launch",
  "sqlite",
  "fts5",
  "binary-size",
]);
const EXPECTED_PLATFORMS = ["windows", "macos", "linux"];
const EXPECTED_FAMILY = { windows: "windows", macos: "unix", linux: "unix" };
const SUPPORTED_ARCHITECTURES = new Set(["x86_64", "aarch64"]);

export function parseReport(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
      }
    });
}

function recordsFor(records, mode) {
  return records.filter((record) => record.schema === 1 && record.mode === mode);
}

function single(records, mode) {
  const matches = recordsFor(records, mode);
  if (matches.length !== 1) {
    throw new Error(`Expected one ${mode} record, found ${matches.length}`);
  }
  return matches[0];
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function nonNegative(value, label) {
  const measured = finite(value, label);
  if (measured < 0) throw new Error(`${label} must be non-negative`);
  return measured;
}

function positive(value, label) {
  const measured = finite(value, label);
  if (measured <= 0) throw new Error(`${label} must be positive`);
  return measured;
}

function validateLaunch(records, target) {
  const matches = recordsFor(records, "launch").filter(
    (record) => record.target === target,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one ${target} launch record, found ${matches.length}`);
  }
  const launch = matches[0];
  if (!Number.isInteger(launch.iterations) || launch.iterations < 20) {
    throw new Error(`${target} launch iterations must be an integer of at least 20`);
  }
  const p50 = nonNegative(launch.p50Micros, `${target} launch p50`);
  const p95 = nonNegative(launch.p95Micros, `${target} launch p95`);
  if (p95 < p50) throw new Error(`${target} launch p95 cannot be below p50`);
  return launch;
}

export function validateReport(records, expectedOs, report = "report") {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`${report} must contain records`);
  }
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`${report} contains a non-object record`);
    }
    if (record.schema !== 1) throw new Error(`Unsupported report schema ${record.schema}`);
    if (!EXPECTED_MODES.has(record.mode)) {
      throw new Error(`Unexpected report mode ${record.mode}`);
    }
  }

  const platform = single(records, "platform");
  const baseline = single(records, "baseline");
  const prepare = single(records, "prepare");
  const ready = single(records, "ready-sqlite");
  const sqlite = single(records, "sqlite");
  const fts5 = single(records, "fts5");
  const binarySize = single(records, "binary-size");
  const launches = recordsFor(records, "launch");

  if (launches.length !== 2) {
    throw new Error(`Expected two launch records, found ${launches.length}`);
  }
  const baselineLaunch = validateLaunch(records, "baseline");
  const sqliteLaunch = validateLaunch(records, "ready-sqlite");
  if (expectedOs && platform.os !== expectedOs) {
    throw new Error(`Expected platform ${expectedOs}, received ${platform.os}`);
  }
  if (!EXPECTED_PLATFORMS.includes(platform.os)) {
    throw new Error(`Unsupported platform ${platform.os}`);
  }
  if (platform.pointerWidth !== 64) {
    throw new Error(`Expected a 64-bit binary, received ${platform.pointerWidth}`);
  }
  if (!SUPPORTED_ARCHITECTURES.has(platform.arch)) {
    throw new Error(`Unsupported 64-bit architecture ${platform.arch}`);
  }
  if (platform.family !== EXPECTED_FAMILY[platform.os]) {
    throw new Error(
      `Platform ${platform.os} must report family ${EXPECTED_FAMILY[platform.os]}`,
    );
  }
  if (prepare.fts5 !== true) throw new Error("Prepared database must enable FTS5");
  if (sqlite.records !== 10_000 || fts5.records !== 10_000) {
    throw new Error("SQLite and FTS5 workloads must each contain 10,000 records");
  }
  if (sqlite.resultCount !== 10_000 || fts5.resultCount !== 100) {
    throw new Error("SQLite and FTS5 workloads returned unexpected result counts");
  }

  for (const [name, record] of [
    ["SQLite", sqlite],
    ["FTS5", fts5],
  ]) {
    for (const field of [
      "openMicros",
      "insertMicros",
      "firstQueryMicros",
      "queryP50Micros",
      "queryP95Micros",
    ]) {
      nonNegative(record[field], `${name} ${field}`);
    }
    positive(record.rssBytes, `${name} RSS`);
    positive(record.databaseBytes, `${name} database size`);
    if (record.queryP95Micros < record.queryP50Micros) {
      throw new Error(`${name} query p95 cannot be below p50`);
    }
  }

  nonNegative(ready.readyMicros, "ready time");
  const idleRssDelta =
    positive(ready.rssBytes, "ready RSS") -
    positive(baseline.rssBytes, "baseline RSS");
  if (idleRssDelta < 0 || idleRssDelta > 4 * 1024 * 1024) {
    throw new Error(`Idle RSS delta ${idleRssDelta} B is outside the accepted 0..4 MiB range`);
  }
  if (fts5.queryP95Micros >= 20_000) {
    throw new Error(`FTS5 p95 ${fts5.queryP95Micros} us exceeds the 20 ms budget`);
  }

  const binaryDelta =
    positive(binarySize.sqliteBytes, "SQLite binary size") -
    positive(binarySize.baselineBytes, "baseline binary size");
  if (binaryDelta <= 0) {
    throw new Error(`SQLite binary delta must be positive, received ${binaryDelta} B`);
  }

  return {
    status: "accepted",
    report: report.replaceAll("\\", "/"),
    platform,
    idleRssDelta,
    fts5P95Micros: fts5.queryP95Micros,
    binaryDelta,
    launches: { baseline: baselineLaunch, sqlite: sqliteLaunch },
  };
}

export function validateMatrix(entries) {
  const reports = entries.map(({ label, records }) =>
    validateReport(records, undefined, label),
  );
  for (const expected of EXPECTED_PLATFORMS) {
    const count = reports.filter((report) => report.platform.os === expected).length;
    if (count !== 1) throw new Error(`Expected one ${expected} report, found ${count}`);
  }
  if (reports.length !== EXPECTED_PLATFORMS.length) {
    throw new Error(`Expected ${EXPECTED_PLATFORMS.length} reports, found ${reports.length}`);
  }
  return {
    status: "accepted",
    platforms: [...EXPECTED_PLATFORMS],
    reports: EXPECTED_PLATFORMS.map((platform) =>
      reports.find((report) => report.platform.os === platform),
    ),
  };
}

async function main() {
  const reportPath = resolve(
    process.argv[2] ?? "scripts/cortex-eval/sqlite-spike/reports/metrics.ndjson",
  );
  const expectedOs = process.argv[3];
  const records = parseReport(await readFile(reportPath, "utf8"));
  process.stdout.write(`${JSON.stringify(validateReport(records, expectedOs, reportPath))}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
