import type {
  WalkthroughDocument,
  WalkthroughReference,
  WalkthroughSection,
} from "../types";

export type RawWalkthroughSection = {
  id?: string;
  title: string;
  intent: string;
  description: string;
  references?: Array<{
    path: string;
    startLine?: number;
    endLine?: number;
    label?: string;
  }>;
  risks?: string[];
};

export type RawWalkthroughInput = {
  id?: string;
  title?: string;
  summary: string;
  sections: RawWalkthroughSection[];
};

export type FileValidationInfo = {
  lineCount?: number;
};

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

export function validateWalkthrough(
  raw: RawWalkthroughInput,
  changedFiles: readonly string[],
  fileInfoMap?: Record<string, FileValidationInfo>,
): WalkthroughDocument {
  const normalizedChangedMap = new Map<string, string>();
  for (const f of changedFiles) {
    normalizedChangedMap.set(normalizePath(f), f);
  }

  const referencedPaths = new Set<string>();
  let allReferencesValid = true;

  const sections: WalkthroughSection[] = (raw.sections || []).map(
    (sec, secIdx) => {
      const validatedRefs: WalkthroughReference[] = (sec.references || []).map(
        (ref) => {
          const normRefPath = normalizePath(ref.path || "");
          const canonicalPath = normalizedChangedMap.get(normRefPath);

          if (!canonicalPath) {
            allReferencesValid = false;
            return {
              path: ref.path || "unknown",
              startLine: ref.startLine ?? 1,
              endLine: ref.endLine ?? 1,
              label: ref.label,
              status: "invalid" as const,
              invalidReason: "File is not part of the changed file set",
            };
          }

          referencedPaths.add(canonicalPath);

          const startLine = Number(ref.startLine ?? 1);
          const endLine = Number(ref.endLine ?? startLine);

          if (isNaN(startLine) || isNaN(endLine) || startLine < 1 || endLine < startLine) {
            allReferencesValid = false;
            return {
              path: canonicalPath,
              startLine: Math.max(1, isNaN(startLine) ? 1 : startLine),
              endLine: Math.max(1, isNaN(endLine) ? 1 : endLine),
              label: ref.label,
              status: "invalid" as const,
              invalidReason: `Invalid line range ${startLine}-${endLine}`,
            };
          }

          const fileInfo = fileInfoMap?.[canonicalPath];
          if (fileInfo?.lineCount !== undefined && endLine > fileInfo.lineCount) {
            allReferencesValid = false;
            return {
              path: canonicalPath,
              startLine,
              endLine,
              label: ref.label,
              status: "invalid" as const,
              invalidReason: `Line range ${startLine}-${endLine} exceeds file length (${fileInfo.lineCount})`,
            };
          }

          return {
            path: canonicalPath,
            startLine,
            endLine,
            label: ref.label,
            status: "valid" as const,
          };
        },
      );

      return {
        id: sec.id || `section_${secIdx + 1}`,
        title: sec.title || `Section ${secIdx + 1}`,
        intent: sec.intent || "Code modification",
        description: sec.description || "",
        references: validatedRefs,
        risks: Array.isArray(sec.risks) ? sec.risks : [],
      };
    },
  );

  const unmentionedFiles = changedFiles.filter((f) => !referencedPaths.has(f));
  const total = Math.max(changedFiles.length, 1);
  const covered = changedFiles.length - unmentionedFiles.length;
  const coverageRatio = Math.round((covered / total) * 100) / 100;

  return {
    id: raw.id || `wt_${Date.now()}`,
    title: raw.title || "Code Change Walkthrough",
    summary: raw.summary || "",
    sections,
    unmentionedFiles,
    totalChangedFiles: changedFiles.length,
    coverageRatio,
    isValid: allReferencesValid,
    createdAt: Date.now(),
  };
}
