import { z } from "zod";
import schemaText from "@/../templates/workspace-kit/contracts/memory-scope.schema.json?raw";
import {
  makeIssue,
  parseDocument,
} from "@/modules/workspace-kit/lib/validation";

const schema = z.fromJSONSchema(JSON.parse(schemaText));
type ObservationState =
  | "absent"
  | "reserved"
  | "valid"
  | "invalid"
  | "partial"
  | "denied"
  | "unavailable";
type ScopeFacts = {
  purpose: "discover" | "initialize" | "manage";
  ancestors: {
    directoryKey: string;
    parentKey: string | null;
    state: ObservationState;
  }[];
  stop: string;
  elapsedMs: number;
  descendants: {
    rootKey: string;
    stop: string;
    entries: number;
    findings: {
      directoryKey: string;
      state:
        | Exclude<ObservationState, "absent" | "reserved">
        | "unverified_link";
    }[];
    elapsedMs: number;
  } | null;
};

export type MemoryScope = Readonly<{
  schema: 1;
  state:
    | "ready"
    | "absent"
    | "reserved"
    | "invalid"
    | "partial"
    | "denied"
    | "ambiguous"
    | "incomplete";
  rootKey: string | null;
  ancestorKits: readonly string[];
  descendantKits: readonly string[];
  blockedKeys: readonly string[];
  ancestryComplete: boolean;
  descendantsComplete: boolean | null;
  initialization: "not_requested" | "not_checked" | "blocked" | "clear";
}>;

export function resolveMemoryScope(text: string): MemoryScope {
  const facts = schema.parse(parseDocument(text)) as ScopeFacts;
  const seen = new Set<string>();
  for (const [index, node] of facts.ancestors.entries()) {
    if (
      seen.has(node.directoryKey) ||
      node.parentKey === node.directoryKey ||
      (index > 0 &&
        facts.ancestors[index - 1].parentKey !== node.directoryKey) ||
      (index === facts.ancestors.length - 1 &&
        facts.stop === "root" &&
        node.parentKey !== null)
    )
      throw new z.ZodError([
        makeIssue("KIT_SCOPE_CHAIN_INVALID", ["ancestors", index]),
      ]);
    seen.add(node.directoryKey);
  }
  const last = facts.ancestors[facts.ancestors.length - 1];
  if (last.parentKey !== null && seen.has(last.parentKey))
    throw new z.ZodError([
      makeIssue("KIT_SCOPE_CHAIN_INVALID", [
        "ancestors",
        facts.ancestors.length - 1,
      ]),
    ]);
  const scan = facts.descendants;
  if (scan && facts.purpose === "discover")
    throw new z.ZodError([
      makeIssue("KIT_SCOPE_SCAN_UNEXPECTED", ["descendants"]),
    ]);
  if (scan && scan.rootKey !== facts.ancestors[0].directoryKey)
    throw new z.ZodError([
      makeIssue("KIT_SCOPE_TARGET_MISMATCH", ["descendants", "rootKey"]),
    ]);
  const findingKeys = new Set<string>();
  for (const [index, finding] of (scan?.findings ?? []).entries()) {
    if (seen.has(finding.directoryKey) || findingKeys.has(finding.directoryKey))
      throw new z.ZodError([
        makeIssue("KIT_SCOPE_FINDING_INVALID", [
          "descendants",
          "findings",
          index,
        ]),
      ]);
    findingKeys.add(finding.directoryKey);
  }
  if (scan && scan.entries < scan.findings.length)
    throw new z.ZodError([
      makeIssue("KIT_SCOPE_FINDING_INVALID", ["descendants", "entries"]),
    ]);
  const ancestorKits = facts.ancestors
    .filter((node) => node.state === "valid")
    .map((node) => node.directoryKey);
  const descendantKits = (scan?.findings ?? [])
    .filter((node) => node.state === "valid")
    .map((node) => node.directoryKey);
  const bad = facts.ancestors.filter(
    (node) =>
      node.state !== "absent" &&
      node.state !== "reserved" &&
      node.state !== "valid",
  );
  const blockedKeys = [
    ...bad,
    ...(scan?.findings ?? []).filter((node) => node.state !== "valid"),
  ].map((node) => node.directoryKey);
  const ancestryComplete =
    facts.stop === "root" &&
    facts.elapsedMs <= 5000 &&
    !facts.ancestors.some(
      (node) => node.state === "denied" || node.state === "unavailable",
    );
  const descendantsComplete = scan
    ? scan.stop === "complete" &&
      scan.elapsedMs <= 10000 &&
      !scan.findings.some(
        (node) =>
          node.state === "denied" ||
          node.state === "unavailable" ||
          node.state === "unverified_link",
      )
    : null;
  let state: MemoryScope["state"] = "absent";
  if (ancestorKits.length > 1) state = "ambiguous";
  else if (bad.length) {
    switch (bad[0].state) {
      case "invalid":
      case "partial":
      case "denied":
        state = bad[0].state;
        break;
      default:
        state = "incomplete";
    }
  } else if (!ancestryComplete) state = "incomplete";
  else if (ancestorKits.length) state = "ready";
  else if (facts.ancestors.some((node) => node.state === "reserved"))
    state = "reserved";
  if (ancestorKits.length && scan) {
    if (descendantKits.length) state = "ambiguous";
    else if (state === "ready") {
      if (
        scan.findings.some(
          (node) => node.state === "invalid" || node.state === "partial",
        )
      )
        state = "partial";
      else if (!descendantsComplete) state = "incomplete";
    }
  }
  const initialization: MemoryScope["initialization"] =
    facts.purpose !== "initialize"
      ? "not_requested"
      : state !== "absent" && state !== "reserved"
        ? "blocked"
        : !scan
          ? "not_checked"
          : !descendantsComplete || scan.findings.length > 0
            ? "blocked"
            : "clear";
  return Object.freeze({
    schema: 1,
    state,
    rootKey: ancestorKits[0] ?? null,
    ancestorKits: Object.freeze(ancestorKits),
    descendantKits: Object.freeze(descendantKits),
    blockedKeys: Object.freeze(blockedKeys),
    ancestryComplete,
    descendantsComplete,
    initialization,
  });
}
