import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const input = resolve(process.argv[2]);
const projectRoot = resolve(process.argv[3] ?? ".");
const projectUri = pathToFileURL(projectRoot).href.replace(/\/$/, "");
const document = JSON.parse(await readFile(input, "utf8"));

function normalize(value) {
  if (typeof value === "string") return value.replaceAll(projectUri, "file:///workspace");
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

await writeFile(input, `${JSON.stringify(normalize(document), null, 2)}\n`, "utf8");
