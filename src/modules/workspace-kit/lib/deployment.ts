import type { KitFile } from "@/modules/workspace-kit/lib/template";

export type KitPathFact =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "file"; text: string }>
  | Readonly<{ kind: "blocked" }>;

export type KitDeploymentEntry = Readonly<{
  path: string;
  action: "create" | "skip" | "conflict" | "migrate";
  reason:
    | "missing"
    | "identical"
    | "different"
    | "unavailable"
    | "root-link"
    | "private-ignore"
    | "missing-link-target";
  expected: string | null;
  proposed: string;
}>;

const START = "<!-- voktty-workspace-kit:start -->";
const END = "<!-- voktty-workspace-kit:end -->";
const claudeLink = /(?:^|\r?\n)\s*@AGENTS\.md\s*(?:\r?\n|$)/;
const reserved = new Set([
  "state",
  "mailbox",
  "locks",
  "sessions",
  "tasks",
  "tasks.json",
  "tools.json",
]);

function isMarkerLine(text: string, offset: number, marker: string): boolean {
  const after = text.slice(offset + marker.length);
  return (
    (offset === 0 || text[offset - 1] === "\n") &&
    (!after || after.startsWith("\n") || after.startsWith("\r\n"))
  );
}

function mergeAgentBlock(current: string, template: string): string | null {
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start === -1 && end === -1) {
    return (
      current +
      (!current ? "" : current.endsWith("\n") ? "\n" : "\n\n") +
      template
    );
  }
  if (
    start === -1 ||
    end < start ||
    current.indexOf(START, start + 1) !== -1 ||
    current.indexOf(END, end + 1) !== -1 ||
    !isMarkerLine(current, start, START) ||
    !isMarkerLine(current, end, END)
  )
    return null;
  return (
    current.slice(0, start) +
    template.trimEnd() +
    current.slice(end + END.length)
  );
}

function privateIgnore(files: readonly KitFile[]): string {
  const allowed = new Set<string>(["kit.lock.json"]);
  for (const file of files) {
    if (!file.path.startsWith(".voktty/")) continue;
    const parts = file.path.slice(".voktty/".length).split("/");
    for (let index = 1; index < parts.length; index += 1) {
      allowed.add(`${parts.slice(0, index).join("/")}/`);
    }
    allowed.add(parts.join("/"));
  }
  return (
    "# Preserve privacy of existing and unknown .voktty data.\n*\n" +
    [...allowed]
      .sort()
      .map((path) => `!/${path}`)
      .join("\n") +
    "\n"
  );
}

export function planKitDeployment(
  files: readonly KitFile[],
  facts: ReadonlyMap<string, KitPathFact>,
  rootLinks: Readonly<{ agents: boolean; claude: boolean }> = {
    agents: false,
    claude: false,
  },
): Readonly<{ entries: readonly KitDeploymentEntry[]; canPublish: boolean }> {
  const seen = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    const rootLink =
      file.kind === "link" &&
      (file.path === "AGENTS.md" || file.path === "CLAUDE.md");
    if (
      (!rootLink &&
        (segments.length < 2 ||
          segments[0] !== ".voktty" ||
          reserved.has(segments[1]?.toLowerCase()))) ||
      segments.some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
      ) ||
      seen.has(file.path.toLowerCase())
    )
      throw new Error(`Invalid deployment path: ${file.path}`);
    seen.add(file.path.toLowerCase());
  }
  const ignore = privateIgnore(files);
  const entries = files
    .filter(
      (file) =>
        file.kind !== "link" ||
        (file.path === "AGENTS.md" ? rootLinks.agents : rootLinks.claude),
    )
    .map((file): KitDeploymentEntry => {
      const fact = facts.get(file.path);
      if (!fact)
        throw new Error(`Missing deployment observation: ${file.path}`);
      if (fact.kind === "blocked")
        return Object.freeze({
          path: file.path,
          action: "conflict",
          reason: "unavailable",
          expected: null,
          proposed: file.text,
        });
      if (
        file.path === "CLAUDE.md" &&
        !rootLinks.agents &&
        !(
          fact.kind === "file" &&
          (claudeLink.test(fact.text) || fact.text.includes(".voktty/"))
        )
      ) {
        const agents = facts.get("AGENTS.md");
        if (!agents)
          throw new Error("Missing deployment observation: AGENTS.md");
        if (agents.kind !== "file")
          return Object.freeze({
            path: file.path,
            action: "conflict",
            reason: "missing-link-target",
            expected: fact.kind === "file" ? fact.text : null,
            proposed: file.text,
          });
      }
      if (fact.kind === "absent")
        return Object.freeze({
          path: file.path,
          action: "create",
          reason: "missing",
          expected: null,
          proposed: file.text,
        });
      let proposed = file.text;
      let reason: KitDeploymentEntry["reason"] = "different";
      if (
        file.path === ".voktty/.gitignore" &&
        (fact.text.trim() === "*" || fact.text === ignore)
      ) {
        proposed = ignore;
        reason = "private-ignore";
      } else if (file.path === "AGENTS.md") {
        const merged = mergeAgentBlock(fact.text, file.text);
        if (merged === null)
          return Object.freeze({
            path: file.path,
            action: "conflict",
            reason: "different",
            expected: fact.text,
            proposed: file.text,
          });
        proposed = merged;
        reason = "root-link";
      } else if (file.path === "CLAUDE.md") {
        proposed =
          claudeLink.test(fact.text) || fact.text.includes(".voktty/")
            ? fact.text
            : fact.text +
              (fact.text.endsWith("\n") ? "\n" : "\n\n") +
              file.text;
        reason = "root-link";
      }
      const action =
        fact.text === proposed
          ? "skip"
          : reason === "different"
            ? "conflict"
            : "migrate";
      return Object.freeze({
        path: file.path,
        action,
        reason: action === "skip" ? "identical" : reason,
        expected: fact.text,
        proposed,
      });
    });
  entries.sort(
    (left, right) =>
      Number(left.path === ".voktty/kit.json") -
      Number(right.path === ".voktty/kit.json"),
  );
  return Object.freeze({
    entries: Object.freeze(entries),
    canPublish: entries.every((entry) => entry.action !== "conflict"),
  });
}
