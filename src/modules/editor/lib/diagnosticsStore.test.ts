import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PROBLEM_DOCUMENTS_PER_OWNER,
  useDiagnosticsStore,
} from "./diagnosticsStore";
import { normalizeLspDiagnostics } from "./problems";

const problem = normalizeLspDiagnostics("/repo/src/main.ts", [
  {
    range: {
      start: { line: 2, character: 4 },
      end: { line: 2, character: 8 },
    },
    severity: 1,
    message: "Broken",
  },
])[0];

describe("diagnostics store problem ownership", () => {
  beforeEach(() => {
    useDiagnosticsStore.setState({ byPath: {}, problemDocuments: {} });
  });

  it("replaces a document batch without duplicating diagnostics", () => {
    const store = useDiagnosticsStore.getState();
    store.publishProblems("ts:/repo", "/repo", "/repo/src/main.ts", [problem]);
    store.publishProblems("ts:/repo", "/repo", "/repo/src/main.ts", [problem]);

    const documents = useDiagnosticsStore.getState().problemDocuments;
    expect(Object.keys(documents)).toHaveLength(1);
    expect(Object.values(documents)[0].problems).toHaveLength(1);
  });

  it("clears an empty publication and all batches owned by a closed session", () => {
    const store = useDiagnosticsStore.getState();
    store.publishProblems("ts:/repo", "/repo", "/repo/src/main.ts", [problem]);
    store.publishProblems("rust:/repo", "/repo", "/repo/src/lib.rs", [
      { ...problem, path: "/repo/src/lib.rs" },
    ]);
    store.publishProblems("ts:/repo", "/repo", "/repo/src/main.ts", []);

    expect(
      Object.keys(useDiagnosticsStore.getState().problemDocuments),
    ).toEqual(["rust:/repo\u0000/repo/src/lib.rs"]);

    useDiagnosticsStore.getState().clearProblemOwner("rust:/repo");
    expect(useDiagnosticsStore.getState().problemDocuments).toEqual({});
  });

  it("bounds the number of diagnostic documents retained per session", () => {
    const store = useDiagnosticsStore.getState();
    for (let index = 0; index <= MAX_PROBLEM_DOCUMENTS_PER_OWNER; index += 1) {
      const path = `/repo/src/file-${index}.ts`;
      store.publishProblems("ts:/repo", "/repo", path, [
        { ...problem, id: String(index), path },
      ]);
    }

    const documents = Object.values(
      useDiagnosticsStore.getState().problemDocuments,
    );
    expect(documents).toHaveLength(MAX_PROBLEM_DOCUMENTS_PER_OWNER);
    expect(
      documents.some((document) => document.path.endsWith("file-0.ts")),
    ).toBe(false);
  });
});
