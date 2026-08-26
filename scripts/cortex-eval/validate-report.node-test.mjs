import assert from "node:assert/strict";
import test from "node:test";
import { validateMatrix, validateReport } from "./validate-report.mjs";

function validRecords(os = "windows") {
  const windows = os === "windows";
  return [
    {
      schema: 1,
      mode: "platform",
      os,
      arch: "x86_64",
      family: windows ? "windows" : "unix",
      pointerWidth: 64,
    },
    { schema: 1, mode: "baseline", rssBytes: 1_000, pid: 10 },
    { schema: 1, mode: "prepare", fts5: true },
    { schema: 1, mode: "ready-sqlite", readyMicros: 20, rssBytes: 2_000 },
    {
      schema: 1,
      mode: "launch",
      target: "baseline",
      iterations: 20,
      p50Micros: 10,
      p95Micros: 15,
    },
    {
      schema: 1,
      mode: "launch",
      target: "ready-sqlite",
      iterations: 20,
      p50Micros: 12,
      p95Micros: 18,
    },
    {
      schema: 1,
      mode: "sqlite",
      records: 10_000,
      openMicros: 10,
      insertMicros: 100,
      firstQueryMicros: 2,
      queryP50Micros: 2,
      queryP95Micros: 3,
      resultCount: 10_000,
      rssBytes: 3_000,
      databaseBytes: 100,
    },
    {
      schema: 1,
      mode: "fts5",
      records: 10_000,
      openMicros: 10,
      insertMicros: 100,
      firstQueryMicros: 2,
      queryP50Micros: 2,
      queryP95Micros: 3_000,
      resultCount: 100,
      rssBytes: 3_000,
      databaseBytes: 120,
    },
    {
      schema: 1,
      mode: "binary-size",
      baselineBytes: 100,
      sqliteBytes: 200,
    },
  ];
}

test("accepts one complete attributable report", () => {
  const result = validateReport(validRecords(), "windows", "windows.ndjson");

  assert.equal(result.platform.os, "windows");
  assert.equal(result.idleRssDelta, 1_000);
});

test("rejects duplicate launch targets", () => {
  const records = validRecords();
  records[5] = { ...records[4] };

  assert.throws(
    () => validateReport(records, "windows", "duplicate.ndjson"),
    /Expected one baseline launch record, found 2/,
  );
});

test("rejects unknown records instead of ignoring them", () => {
  const records = [...validRecords(), { schema: 1, mode: "injected" }];

  assert.throws(
    () => validateReport(records, "windows", "unknown.ndjson"),
    /Unexpected report mode injected/,
  );
});

test("rejects an architecture or family inconsistent with the platform", () => {
  const records = validRecords("macos");
  records[0] = { ...records[0], arch: "wasm32", family: "windows" };

  assert.throws(
    () => validateReport(records, "macos", "spoofed.ndjson"),
    /Unsupported 64-bit architecture wasm32/,
  );
});

test("rejects duplicate platform reports", () => {
  assert.throws(
    () =>
      validateMatrix([
        { label: "windows-a", records: validRecords("windows") },
        { label: "windows-b", records: validRecords("windows") },
        { label: "linux", records: validRecords("linux") },
      ]),
    /Expected one windows report, found 2/,
  );
});

test("requires every target platform", () => {
  assert.throws(
    () =>
      validateMatrix([
        { label: "windows", records: validRecords("windows") },
        { label: "linux", records: validRecords("linux") },
      ]),
    /Expected one macos report, found 0/,
  );
});

test("accepts a complete Windows, macOS and Linux matrix", () => {
  const result = validateMatrix([
    { label: "windows", records: validRecords("windows") },
    { label: "macos", records: validRecords("macos") },
    { label: "linux", records: validRecords("linux") },
  ]);

  assert.deepEqual(
    result.reports.map((report) => report.platform.os),
    ["windows", "macos", "linux"],
  );
});
