import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import {
  isUnicodeScalarText,
  parseKitConfig,
} from "@/modules/workspace-kit/lib/validation";

export type MemoryText = Readonly<{
  bytes: number;
  chars: number;
  ids: readonly Readonly<{
    id: string;
    state: "open" | "done";
    line: number;
  }>[];
  planState: "open" | "written" | "waiting" | "parked" | "closed" | "unknown";
  milestones: readonly Readonly<{
    id: string;
    state: "pending" | "in progress" | "done";
    line: number;
  }>[];
  upNext: number | null;
  warnings: readonly string[];
  complete: boolean;
}>;

const encoder = new TextEncoder();
const planStates = new Set(["open", "written", "waiting", "parked", "closed"]);
const milestoneStates = new Set(["pending", "in progress", "done"]);
const trim = (text: string) => text.trim();

function visibleLine(line: string, comment: { open: boolean }): string {
  let visible = "";
  let index = 0;
  while (index < line.length) {
    if (comment.open) {
      const end = line.indexOf("-->", index);
      if (end === -1) break;
      comment.open = false;
      index = end + 3;
      visible += " ";
    } else if (line.startsWith("<!--", index)) {
      comment.open = true;
      index += 4;
      visible += " ";
    } else if (
      line[index] === "`" &&
      (index === 0 || line[index - 1] !== "\\")
    ) {
      let end = index + 1;
      while (line[end] === "`") end += 1;
      const marker = line.slice(index, end);
      let closing = line.indexOf(marker, end);
      while (
        closing !== -1 &&
        (line[closing - 1] === "`" || line[closing + marker.length] === "`")
      )
        closing = line.indexOf(marker, closing + marker.length);
      if (closing === -1) {
        visible += marker;
        index = end;
      } else {
        visible += " ";
        index = closing + marker.length;
      }
    } else {
      visible += line[index];
      index += 1;
    }
  }
  return visible;
}

export function inspectMemoryText(
  text: string,
  upNextHeading = "Up next",
): MemoryText {
  if (text.length > 256 * 1024) throw new Error("KIT_MEMORY_TEXT_TOO_LARGE");
  const bytes = encoder.encode(text).byteLength;
  if (bytes > 256 * 1024) throw new Error("KIT_MEMORY_TEXT_TOO_LARGE");
  if (
    !isUnicodeScalarText(text) ||
    text.includes("\0") ||
    !isUnicodeScalarText(upNextHeading) ||
    !upNextHeading.trim() ||
    upNextHeading.length > 128 ||
    encoder.encode(upNextHeading).byteLength > 128 ||
    /[\r\n\0]/.test(upNextHeading)
  )
    throw new Error("KIT_MEMORY_TEXT_INVALID");
  const ids: { id: string; state: "open" | "done"; line: number }[] = [];
  const milestones: {
    id: string;
    state: "pending" | "in progress" | "done";
    line: number;
  }[] = [];
  const states = new Set<string>();
  const warnings: string[] = [];
  const comment = { open: false };
  let fence: { marker: string; length: number } | null = null;
  let header = true;
  let sections = 0;
  let inNext = false;
  const bullets: number[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      )
        fence = null;
      continue;
    }
    if (!comment.open) {
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/s.exec(line);
      if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
        fence = { marker: opening[1][0], length: opening[1].length };
        continue;
      }
    }
    const visible = visibleLine(line, comment);
    for (const match of visible.matchAll(/\[([TDQ]-[1-9][0-9]*)( done)?\]/g)) {
      ids.push({
        id: match[1],
        state: match[2] ? "done" : "open",
        line: index + 1,
      });
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+)$/s.exec(visible);
    if (heading && heading[1].length >= 2) {
      header = false;
      if (heading[1].length === 2) {
        inNext =
          trim(heading[2].replace(/[ \t]+#+[ \t]*$/, "")) ===
          trim(upNextHeading);
        if (inNext) sections += 1;
      }
      if (heading[1].length === 3) {
        const milestone = /^M([1-9][0-9]*):/.exec(heading[2]);
        const state =
          /^(pending|in progress|done)(?: [0-9]{4}-[0-9]{2}-[0-9]{2})?$/.exec(
            trim(heading[2].split("·")[1] ?? ""),
          )?.[1];
        if (milestone && state && milestoneStates.has(state))
          milestones.push({
            id: `M${milestone[1]}`,
            state: state as "pending" | "in progress" | "done",
            line: index + 1,
          });
      }
    }
    if (header && !/^(?:[ #>\t]|[-+*][ \t]|[0-9]+[.)][ \t])/.test(visible)) {
      for (const part of visible.split("·")) {
        const state =
          /^[^:]+:[ \t]*(?:\*\*)?(open|written|waiting|parked|closed)(?:\*\*)?(?:[ \t]|$)/.exec(
            part.trim(),
          );
        if (state && planStates.has(state[1])) states.add(state[1]);
      }
    }
    if (inNext) {
      const bullet = /^( {0,3})(?:[-+*]|[0-9]+[.)])[ \t]+/.exec(visible);
      if (bullet) bullets.push(bullet[1].length);
    }
  }
  if (fence) warnings.push("unclosed-fence");
  if (comment.open) warnings.push("unclosed-comment");
  if (sections > 1) warnings.push("duplicate-up-next");
  if (states.size > 1) warnings.push("conflicting-plan-state");
  const indentation = bullets.reduce(
    (minimum, indent) => Math.min(minimum, indent),
    4,
  );
  return Object.freeze({
    bytes,
    chars: [...text].length,
    ids: Object.freeze(ids.map((item) => Object.freeze(item))),
    planState:
      states.size === 1
        ? ([...states][0] as MemoryText["planState"])
        : "unknown",
    milestones: Object.freeze(milestones.map((item) => Object.freeze(item))),
    upNext:
      sections === 1
        ? bullets.filter((indent) => indent === indentation).length
        : null,
    warnings: Object.freeze(warnings),
    complete: warnings.length === 0,
  });
}

export type HandoffInventory = Readonly<{
  complete: boolean;
  files: readonly Readonly<{ name: string; createdAtMs: number | null }>[];
}>;
export type MemoryMeasurement = Readonly<{
  path: string;
  metric: "chars" | "up-next" | "files" | "age-ms";
  value: number | null;
  limit: number;
  status: "ok" | "exceeded" | "unknown";
}>;

export function measureMemory(
  configText: string,
  documents: ReadonlyMap<string, KitPathFact>,
  handoffs: HandoffInventory,
  nowMs: number,
  upNextHeading = "Up next",
): Readonly<{
  measurements: readonly MemoryMeasurement[];
  complete: boolean;
  exceeded: boolean;
}> {
  const config = parseKitConfig(configText);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 8640000000000000)
    throw new Error("KIT_MEMORY_TIME_INVALID");
  const measurements: MemoryMeasurement[] = [];
  const add = (
    path: string,
    metric: MemoryMeasurement["metric"],
    value: number | null,
    limit: number,
  ) => {
    measurements.push(
      Object.freeze({
        path,
        metric,
        value,
        limit,
        status: value === null ? "unknown" : value > limit ? "exceeded" : "ok",
      }),
    );
  };
  for (const path of [
    "CONTEXT.md",
    "PROJECT.md",
    "plans/INDEX.md",
    "plans/TRACKING.md",
    "continuity/CHANGELOG.md",
  ] as const) {
    const limit = config.limits[path];
    if (!limit) continue;
    const fact = documents.get(path);
    const text =
      fact?.kind === "file"
        ? inspectMemoryText(fact.text, upNextHeading)
        : null;
    add(path, "chars", text?.chars ?? null, limit.maxChars);
    if ("maxUpNext" in limit)
      add(
        path,
        "up-next",
        text?.complete ? text.upNext : null,
        limit.maxUpNext,
      );
  }
  const limit = config.limits["continuity/handoffs/"];
  if (limit) {
    if (handoffs.files.length > 20000)
      throw new Error("KIT_MEMORY_INVENTORY_TOO_LARGE");
    const names = new Set<string>();
    let count = 0;
    let oldest: number | null = 0;
    for (const file of handoffs.files) {
      if (
        !file.name ||
        file.name.length > 256 ||
        encoder.encode(file.name).byteLength > 256 ||
        /[/\\\0]/.test(file.name) ||
        !isUnicodeScalarText(file.name) ||
        names.has(file.name)
      )
        throw new Error("KIT_MEMORY_INVENTORY_INVALID");
      names.add(file.name);
      if (
        !file.name.toLowerCase().endsWith(".md") ||
        file.name.toLowerCase() === "readme.md"
      )
        continue;
      count += 1;
      if (
        file.createdAtMs === null ||
        !Number.isSafeInteger(file.createdAtMs) ||
        file.createdAtMs < 0 ||
        file.createdAtMs > nowMs
      )
        oldest = null;
      else if (oldest !== null)
        oldest = Math.max(oldest, nowMs - file.createdAtMs);
    }
    add(
      "continuity/handoffs/",
      "files",
      handoffs.complete ? count : null,
      limit.maxFiles,
    );
    add(
      "continuity/handoffs/",
      "age-ms",
      handoffs.complete ? oldest : null,
      limit.maxAgeDays * 86400000,
    );
  }
  return Object.freeze({
    measurements: Object.freeze(measurements),
    complete: measurements.every((entry) => entry.value !== null),
    exceeded: measurements.some((entry) => entry.status === "exceeded"),
  });
}
