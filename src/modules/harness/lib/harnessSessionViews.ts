export interface HarnessSessionViewReport {
  readonly referencedSessionIds: readonly string[];
  readonly foregroundSessionIds: readonly string[];
  readonly activeSessionId: string | null;
}

const MAX_SESSION_ID_LENGTH = 256;

function invalidReport(): never {
  throw new TypeError("Invalid Harness session view report");
}

function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    /\S/u.test(value)
  );
}

function validateRawIds(ids: unknown, maxReferences: number): void {
  if (!Array.isArray(ids) || ids.length > maxReferences) invalidReport();
}

function normalizeIds(ids: readonly string[]): readonly string[] {
  for (const id of ids) {
    if (!isSessionId(id)) invalidReport();
  }
  return Object.freeze([...new Set(ids)].sort());
}

export function normalizeHarnessSessionViewReport(
  input: {
    referencedSessionIds: readonly string[];
    foregroundSessionIds?: readonly string[];
    activeSessionId?: string | null;
  },
  maxReferences = 256,
): HarnessSessionViewReport {
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 0) {
    throw new RangeError("Invalid Harness session reference limit");
  }
  if (input === null || typeof input !== "object") invalidReport();
  const foreground =
    input.foregroundSessionIds === undefined ? [] : input.foregroundSessionIds;
  validateRawIds(input.referencedSessionIds, maxReferences);
  validateRawIds(foreground, maxReferences);
  const referencedSessionIds = normalizeIds(input.referencedSessionIds);
  const foregroundSessionIds = normalizeIds(foreground);
  const referenced = new Set(referencedSessionIds);
  if (foregroundSessionIds.some((id) => !referenced.has(id))) invalidReport();
  const activeSessionId = input.activeSessionId ?? null;
  if (
    activeSessionId !== null &&
    (!isSessionId(activeSessionId) || !referenced.has(activeSessionId))
  ) {
    invalidReport();
  }
  return Object.freeze({
    referencedSessionIds,
    foregroundSessionIds,
    activeSessionId,
  });
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

export function sameHarnessSessionViewReport(
  a: HarnessSessionViewReport,
  b: HarnessSessionViewReport,
): boolean {
  return (
    a.activeSessionId === b.activeSessionId &&
    sameIds(a.referencedSessionIds, b.referencedSessionIds) &&
    sameIds(a.foregroundSessionIds, b.foregroundSessionIds)
  );
}

function unionIds(
  reports: Iterable<HarnessSessionViewReport>,
  field: "referencedSessionIds" | "foregroundSessionIds",
): readonly string[] {
  const ids = new Set<string>();
  for (const report of reports) {
    for (const id of report[field]) ids.add(id);
  }
  return Object.freeze([...ids].sort());
}

export function referencedHarnessSessionIds(
  reports: Iterable<HarnessSessionViewReport>,
): readonly string[] {
  return unionIds(reports, "referencedSessionIds");
}

export function foregroundHarnessSessionIds(
  reports: Iterable<HarnessSessionViewReport>,
): readonly string[] {
  return unionIds(reports, "foregroundSessionIds");
}
