import { create } from "zustand";
import type { IdeProblem, ProblemDocument } from "./problems";

export type DiagnosticCounts = { errors: number; warnings: number };
export const MAX_PROBLEM_DOCUMENTS_PER_OWNER = 500;

type State = {
  byPath: Record<string, DiagnosticCounts>;
  problemDocuments: Record<string, ProblemDocument>;
  report: (path: string, counts: DiagnosticCounts | null) => void;
  publishProblems: (
    owner: string,
    root: string,
    path: string,
    problems: IdeProblem[],
  ) => void;
  clearProblemOwner: (owner: string) => void;
};

export const useDiagnosticsStore = create<State>((set) => ({
  byPath: {},
  problemDocuments: {},
  report: (path, counts) =>
    set((s) => {
      const prev = s.byPath[path];
      if (
        counts &&
        prev &&
        prev.errors === counts.errors &&
        prev.warnings === counts.warnings
      ) {
        return s;
      }
      if (!counts && !prev) return s;
      const byPath = { ...s.byPath };
      if (counts) byPath[path] = counts;
      else delete byPath[path];
      return { byPath };
    }),
  publishProblems: (owner, root, path, problems) =>
    set((state) => {
      const key = `${owner}\u0000${path}`;
      const previous = state.problemDocuments[key];
      if (problems.length === 0) {
        if (!previous) return state;
        const problemDocuments = { ...state.problemDocuments };
        delete problemDocuments[key];
        return { problemDocuments };
      }
      if (previous?.problems === problems) return state;
      const problemDocuments = { ...state.problemDocuments };
      if (!previous) {
        const oldestOwnerEntry = Object.entries(problemDocuments).find(
          ([, document]) => document.owner === owner,
        );
        const ownerDocumentCount = Object.values(problemDocuments).filter(
          (document) => document.owner === owner,
        ).length;
        if (
          ownerDocumentCount >= MAX_PROBLEM_DOCUMENTS_PER_OWNER &&
          oldestOwnerEntry
        ) {
          delete problemDocuments[oldestOwnerEntry[0]];
        }
      }
      problemDocuments[key] = { owner, root, path, problems };
      return {
        problemDocuments,
      };
    }),
  clearProblemOwner: (owner) =>
    set((state) => {
      const entries = Object.entries(state.problemDocuments).filter(
        ([, document]) => document.owner !== owner,
      );
      if (entries.length === Object.keys(state.problemDocuments).length) {
        return state;
      }
      return { problemDocuments: Object.fromEntries(entries) };
    }),
}));
