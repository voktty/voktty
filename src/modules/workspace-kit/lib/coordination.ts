export type NoteKind =
  | "task"
  | "verdict"
  | "decision"
  | "blocker"
  | "status"
  | "question";

export interface WorkReservation {
  readonly agent: string;
  readonly owner: string;
  readonly task: string;
  readonly paths: readonly string[];
  readonly resources: readonly string[];
  readonly updatedAt: string;
}

export interface ClaimsGuard {
  readonly owner: string;
  readonly acquiredAt: string;
}

export interface MailboxNote {
  readonly from: string;
  readonly to: string;
  readonly kind: NoteKind;
  readonly text: string;
  readonly sentAt: string;
}

export type ReservationConflict =
  | {
      readonly type: "resource";
      readonly resource: string;
      readonly holderAgent: string;
      readonly holderOwner: string;
    }
  | {
      readonly type: "path";
      readonly existingPath: string;
      readonly candidatePath: string;
      readonly holderAgent: string;
      readonly holderOwner: string;
    };

export function normalizeReservationPath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");
  const stripped = trimmed.startsWith("./")
    ? trimmed.slice(2).replace(/^\/+/, "")
    : trimmed.replace(/^\/+/, "");
  if (!stripped) return null;
  const parts = stripped.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;
  return parts.join("/");
}

export function pathsOverlap(pathA: string, pathB: string): boolean {
  const normA = normalizeReservationPath(pathA);
  const normB = normalizeReservationPath(pathB);
  if (!normA || !normB) return false;
  const lowerA = normA.toLowerCase();
  const lowerB = normB.toLowerCase();
  if (lowerA === lowerB) return true;
  if (lowerA.startsWith(lowerB) && lowerA[lowerB.length] === "/") return true;
  if (lowerB.startsWith(lowerA) && lowerB[lowerA.length] === "/") return true;
  return false;
}

export function checkReservationConflict(
  existing: readonly WorkReservation[],
  candidate: WorkReservation,
): ReservationConflict | null {
  for (const current of existing) {
    if (current.owner === candidate.owner) continue;

    for (const candRes of candidate.resources) {
      const candTrimmed = candRes.trim();
      if (!candTrimmed) continue;
      for (const currRes of current.resources) {
        if (candTrimmed.toLowerCase() === currRes.trim().toLowerCase()) {
          return {
            type: "resource",
            resource: currRes,
            holderAgent: current.agent,
            holderOwner: current.owner,
          };
        }
      }
    }

    for (const candPath of candidate.paths) {
      for (const currPath of current.paths) {
        if (pathsOverlap(candPath, currPath)) {
          return {
            type: "path",
            existingPath: currPath,
            candidatePath: candPath,
            holderAgent: current.agent,
            holderOwner: current.owner,
          };
        }
      }
    }
  }
  return null;
}

function isValidIdentifier(s: string): boolean {
  return Boolean(s) && s.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(s);
}

function isValidTimestamp(s: string): boolean {
  if (s.length < 20 || s.length > 35) return false;
  if (s[4] !== "-" || s[7] !== "-" || (s[10] !== "T" && s[10] !== "t")) {
    return false;
  }
  return s.endsWith("Z") || s.endsWith("z");
}

export function validateReservation(res: WorkReservation): string[] {
  const issues: string[] = [];
  if (!isValidIdentifier(res.agent)) issues.push("COORDINATION_INVALID_AGENT");
  if (!res.owner?.trim() || res.owner.length > 256) {
    issues.push("COORDINATION_INVALID_OWNER");
  }
  if (!res.task?.trim() || res.task.length > 512) {
    issues.push("COORDINATION_INVALID_TASK");
  }
  if (res.paths.length === 0 && res.resources.length === 0) {
    issues.push("COORDINATION_EMPTY_SCOPE");
  }
  for (const p of res.paths) {
    if (normalizeReservationPath(p) === null) {
      issues.push("COORDINATION_INVALID_PATH");
      break;
    }
  }
  if (!isValidTimestamp(res.updatedAt)) {
    issues.push("COORDINATION_INVALID_TIMESTAMP");
  }
  return issues;
}

export function validateNote(note: MailboxNote): string[] {
  const issues: string[] = [];
  if (!isValidIdentifier(note.from)) issues.push("MAILBOX_INVALID_SENDER");
  if (!isValidIdentifier(note.to)) issues.push("MAILBOX_INVALID_RECIPIENT");
  const validKinds: readonly NoteKind[] = [
    "task",
    "verdict",
    "decision",
    "blocker",
    "status",
    "question",
  ];
  if (!validKinds.includes(note.kind)) issues.push("MAILBOX_INVALID_KIND");
  if (!note.text?.trim() || note.text.length > 65536) {
    issues.push("MAILBOX_INVALID_TEXT");
  }
  if (!isValidTimestamp(note.sentAt)) issues.push("MAILBOX_INVALID_TIMESTAMP");
  return issues;
}

export function parseWorkReservation(text: string): WorkReservation {
  if (text.length > 64 * 1024)
    throw new Error("COORDINATION_DOCUMENT_TOO_LARGE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("COORDINATION_JSON_PARSE_FAILED");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("COORDINATION_INVALID_FORMAT");
  }
  const obj = parsed as Record<string, unknown>;
  const res: WorkReservation = {
    agent: typeof obj.agent === "string" ? obj.agent : "",
    owner: typeof obj.owner === "string" ? obj.owner : "",
    task: typeof obj.task === "string" ? obj.task : "",
    paths: Array.isArray(obj.paths)
      ? obj.paths.filter((p): p is string => typeof p === "string")
      : [],
    resources: Array.isArray(obj.resources)
      ? obj.resources.filter((r): r is string => typeof r === "string")
      : [],
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : "",
  };
  const issues = validateReservation(res);
  if (issues.length > 0) {
    throw new Error(`COORDINATION_VALIDATION_FAILED: ${issues.join(", ")}`);
  }
  return res;
}

export function parseMailboxNote(text: string): MailboxNote {
  if (text.length > 64 * 1024) throw new Error("MAILBOX_DOCUMENT_TOO_LARGE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("MAILBOX_JSON_PARSE_FAILED");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("MAILBOX_INVALID_FORMAT");
  }
  const obj = parsed as Record<string, unknown>;
  const note: MailboxNote = {
    from: typeof obj.from === "string" ? obj.from : "",
    to: typeof obj.to === "string" ? obj.to : "",
    kind: typeof obj.kind === "string" ? (obj.kind as NoteKind) : "task",
    text: typeof obj.text === "string" ? obj.text : "",
    sentAt: typeof obj.sentAt === "string" ? obj.sentAt : "",
  };
  const issues = validateNote(note);
  if (issues.length > 0) {
    throw new Error(`MAILBOX_VALIDATION_FAILED: ${issues.join(", ")}`);
  }
  return note;
}
