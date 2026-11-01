import { visibleMemoryLines } from "@/modules/workspace-kit/lib/memory";
import { scalarCompare } from "@/modules/workspace-kit/lib/preservation";
import { isUnicodeScalarText } from "@/modules/workspace-kit/lib/validation";
const encoder = new TextEncoder();
export type QualifiedMemoryLinks = Readonly<{
  paths: readonly string[];
  unverifiedLines: readonly number[];
  complete: boolean;
}>;
function unqualifiedContainer(line: string): boolean {
  for (let depth = 0; depth < 16; depth += 1) {
    if (
      line.startsWith("    ") ||
      /^ *\t/u.test(line) ||
      line.replace(/^ */u, "").startsWith(">")
    )
      return true;
    const marker = /^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])([ \t]+)/u.exec(line);
    if (!marker) return false;
    if (marker[1].length > 4 || marker[1].includes("\t")) return true;
    line = line.slice(marker[0].length);
  }
  return true;
}
function escaped(line: string, index: number): boolean {
  let count = 0;
  while (index > 0 && line[--index] === "\\") count += 1;
  return count % 2 === 1;
}

function destination(body: string): string | null {
  body = body.replace(/^[ \t]+|[ \t]+$/gu, "");
  let target: string;
  let tail: string;
  if (body.startsWith("<")) {
    const end = body.indexOf(">");
    if (end === -1) return null;
    target = body.slice(1, end);
    tail = body.slice(end + 1).replace(/^[ \t]+|[ \t]+$/gu, "");
  } else {
    const end = body.search(/[ \t]/u);
    target = end === -1 ? body : body.slice(0, end);
    tail = end === -1 ? "" : body.slice(end).replace(/^[ \t]+|[ \t]+$/gu, "");
  }
  if (tail && !/^"[^"\r\n]*"$|^'[^'\r\n]*'$/u.test(tail)) return null;
  return target || null;
}

function target(raw: string, source: string): string | null {
  if (
    raw.length > 4096 ||
    encoder.encode(raw).length > 4096 ||
    /[\p{Cc}<>]/u.test(raw)
  )
    throw new Error("unqualified");
  if (
    raw.toLowerCase().startsWith("https://") ||
    raw.toLowerCase().startsWith("http://") ||
    raw.startsWith("#")
  )
    return null;
  raw = raw.split("#")[0];
  if (raw.startsWith("/") || /[\\:?&]/u.test(raw))
    throw new Error("unqualified");
  const parts = source.split("/").slice(0, -1);
  for (const segment of raw.split("/")) {
    if (!segment || /%(?:2f|5c)/iu.test(segment))
      throw new Error("unqualified");
    const decoded = decodeURIComponent(segment);
    if (/[\p{Cc}\\:%?#&]/u.test(decoded)) throw new Error("unqualified");
    if (decoded === "." || decoded === "..") {
      if (
        segment !== decoded ||
        (decoded === ".." && parts.pop() === undefined)
      )
        throw new Error("unqualified");
    } else parts.push(decoded);
    if (parts.length > 64) throw new Error("unqualified");
  }
  const path = parts.join("/");
  if (encoder.encode(path).length > 4096) throw new Error("unqualified");
  return path;
}

export function inspectMemoryLinks(
  text: string,
  source: string,
  limitCode = "KIT_MEMORY_LINK_LIMIT",
): QualifiedMemoryLinks {
  if (text.length > 256 * 1024 || encoder.encode(text).length > 256 * 1024)
    throw new Error("KIT_MEMORY_TEXT_TOO_LARGE");
  if (!isUnicodeScalarText(text) || text.includes("\0"))
    throw new Error("KIT_MEMORY_TEXT_INVALID");
  const parts = source.split("/");
  if (
    !isUnicodeScalarText(source) ||
    encoder.encode(source).length > 4096 ||
    /[\p{Cc}\\:%?#]/u.test(source) ||
    parts.length > 64 ||
    parts.some((part) => !part || part === "." || part === "..") ||
    !source.endsWith(".md")
  )
    throw new Error("KIT_MEMORY_LINK_SOURCE");
  const linked = new Set<string>(),
    unverified = new Set<number>();
  let count = 0;
  let pending: number | null = null;
  const lines = visibleMemoryLines(text);
  for (const [number, line] of lines.lines) {
    if (unqualifiedContainer(line) && line.replace(/^[ \t]+|[ \t]+$/gu, "")) {
      unverified.add(number + 1);
      if (unverified.size > 1024) throw new Error(limitCode);
      continue;
    }
    if (pending !== null && line.replace(/^[ \t]+/u, "").startsWith("(")) {
      unverified.add(pending);
      unverified.add(number + 1);
    }
    pending = null;
    let i = 0;
    while (i < line.length) {
      if (
        (line[i] === "<" ||
          line.startsWith("```", i) ||
          line.startsWith("~~~", i)) &&
        !escaped(line, i)
      ) {
        unverified.add(number + 1);
        break;
      }
      if (line[i] !== "[" || escaped(line, i)) {
        i += 1;
        continue;
      }
      const close = line.indexOf("]", i + 1);
      if (close === -1) {
        unverified.add(number + 1);
        break;
      }
      const qualifiedLabel =
        !escaped(line, close) && !/[[<]/u.test(line.slice(i + 1, close));
      if (!qualifiedLabel || ["[", ":"].includes(line[close + 1]))
        unverified.add(number + 1);
      if (line[close + 1] !== "(") {
        if (!line.slice(close + 1).replace(/^[ \t]+|[ \t]+$/gu, ""))
          pending = number + 1;
        i = close + 1;
        continue;
      }
      count += 1;
      if (count > 1024) throw new Error(limitCode);
      let end = close + 2,
        depth = 1,
        angle = false;
      while (end < line.length) {
        if (end - close - 2 > 4096) break;
        if (["<", ">", "(", ")"].includes(line[end]) && !escaped(line, end)) {
          if (line[end] === "<") angle = true;
          if (line[end] === ">") angle = false;
          if (!angle) {
            if (line[end] === "(") depth += 1;
            if (line[end] === ")") {
              depth -= 1;
              if (depth === 0) break;
            }
          }
        }
        if (depth > 16) break;
        end += 1;
      }
      if (depth !== 0) {
        unverified.add(number + 1);
        break;
      }
      const image = i > 0 && line[i - 1] === "!" && !escaped(line, i - 1);
      if (!image && qualifiedLabel) {
        try {
          const body = line.slice(close + 2, end);
          if (encoder.encode(body).length > 4096)
            throw new Error("unqualified");
          const value = destination(body);
          if (value === null) throw new Error("unqualified");
          const path = target(value, source);
          if (path !== null) linked.add(path);
        } catch {
          unverified.add(number + 1);
        }
      }
      i = end + 1;
    }
    if (unverified.size > 1024) throw new Error(limitCode);
  }
  const complete = lines.warnings().length === 0 && unverified.size === 0;
  if (!complete) {
    linked.clear();
  }
  return Object.freeze({
    paths: Object.freeze([...linked].sort(scalarCompare)),
    unverifiedLines: Object.freeze([...unverified].sort((a, b) => a - b)),
    complete,
  });
}
