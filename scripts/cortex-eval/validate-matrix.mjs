import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseReport, validateMatrix } from "./validate-report.mjs";

const reportPaths = process.argv.slice(2).map((path) => resolve(path));
const entries = await Promise.all(
  reportPaths.map(async (path) => ({
    label: path,
    records: parseReport(await readFile(path, "utf8")),
  })),
);

process.stdout.write(`${JSON.stringify(validateMatrix(entries))}\n`);
