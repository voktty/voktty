import { isMemoryDocumentPath } from "@/modules/workspace-kit/lib/memoryDocumentPaths";

export type MemoryDocument = Readonly<{
  path: string;
  fact:
    | Readonly<{ kind: "file"; text: string }>
    | Readonly<{ kind: "absent" | "blocked" }>;
}>;
export type MemoryDocuments = Readonly<{
  schema: 1;
  root: string;
  complete: boolean;
  blockedCount: number;
  files: readonly MemoryDocument[];
}>;

const encoder = new TextEncoder();
let pending = 0;
function invalid(): never {
  throw Object.assign(new Error("Memory document snapshot is unavailable"), {
    code: "unavailable",
  });
}
function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function rootValid(root: unknown): root is string {
  if (
    typeof root !== "string" ||
    !root ||
    encoder.encode(root).length > 4096 ||
    /[\p{Cc}]/u.test(root)
  )
    return false;
  for (const char of root) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

export function parseMemoryDocuments(
  value: unknown,
  expectedRoot: string,
): MemoryDocuments {
  const data = record(value);
  keys(data, ["schema", "root", "complete", "blockedCount", "files"]);
  if (
    data.schema !== 1 ||
    !rootValid(data.root) ||
    data.root !== expectedRoot ||
    typeof data.complete !== "boolean" ||
    !Number.isSafeInteger(data.blockedCount) ||
    (data.blockedCount as number) < 0 ||
    (data.blockedCount as number) > 20256 ||
    (data.complete && data.blockedCount !== 0) ||
    !Array.isArray(data.files) ||
    data.files.length > 128
  )
    invalid();
  const wire = JSON.stringify(value);
  if (encoder.encode(wire).length > 4 * 1024 * 1024) invalid();
  const seen = new Set<string>();
  let total = 0;
  let blocked = 0;
  const files = data.files.map((raw): MemoryDocument => {
    const file = record(raw);
    keys(file, ["path", "fact"]);
    if (
      typeof file.path !== "string" ||
      !isMemoryDocumentPath(file.path) ||
      seen.has(file.path)
    )
      invalid();
    seen.add(file.path);
    const fact = record(file.fact);
    if (fact.kind === "file") {
      keys(fact, ["kind", "text"]);
      if (typeof fact.text !== "string") invalid();
      for (const char of fact.text) {
        const code = char.codePointAt(0) ?? 0;
        if (code >= 0xd800 && code <= 0xdfff) invalid();
      }
      const bytes = encoder.encode(fact.text).length;
      total += bytes;
      if (bytes > 256 * 1024 || total > 2 * 1024 * 1024) invalid();
      return Object.freeze({
        path: file.path,
        fact: Object.freeze({ kind: "file", text: fact.text }),
      });
    }
    keys(fact, ["kind"]);
    if (fact.kind !== "absent" && fact.kind !== "blocked") invalid();
    if (fact.kind === "blocked") blocked += 1;
    return Object.freeze({
      path: file.path,
      fact: Object.freeze({ kind: fact.kind }),
    });
  });
  if (blocked > (data.blockedCount as number)) invalid();
  return Object.freeze({
    schema: 1,
    root: data.root,
    complete: data.complete,
    blockedCount: data.blockedCount as number,
    files: Object.freeze(files),
  });
}

export async function loadMemoryDocuments(
  expectedRoot: string,
  load: () => Promise<unknown>,
) {
  if (!rootValid(expectedRoot)) invalid();
  if (pending >= 256)
    throw Object.assign(new Error("Memory document reads are busy"), {
      code: "busy",
    });
  pending += 1;
  try {
    return parseMemoryDocuments(await load(), expectedRoot);
  } finally {
    pending -= 1;
  }
}
