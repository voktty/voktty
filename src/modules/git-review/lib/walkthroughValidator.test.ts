import { describe, expect, it } from "vitest";
import { validateWalkthrough } from "./walkthroughValidator";

describe("walkthroughValidator", () => {
  it("validates well-formed walkthrough references and computes coverage", () => {
    const raw = {
      title: "Feature Walkthrough",
      summary: "Added new review endpoints and models",
      sections: [
        {
          title: "Models",
          intent: "Data structure definitions",
          description: "Defines LineRange and Reconciliation",
          references: [
            {
              path: "src/models.ts",
              startLine: 1,
              endLine: 20,
              label: "Types",
            },
          ],
          risks: ["None"],
        },
        {
          title: "Service Bridge",
          intent: "IPC communication",
          description: "Calls native Rust backend",
          references: [
            {
              path: "src/bridge.ts",
              startLine: 10,
              endLine: 35,
            },
          ],
        },
      ],
    };

    const changedFiles = ["src/models.ts", "src/bridge.ts", "src/unused.ts"];
    const fileInfo = {
      "src/models.ts": { lineCount: 50 },
      "src/bridge.ts": { lineCount: 100 },
    };

    const doc = validateWalkthrough(raw, changedFiles, fileInfo);

    expect(doc.isValid).toBe(true);
    expect(doc.sections.length).toBe(2);
    expect(doc.sections[0].references[0].status).toBe("valid");
    expect(doc.unmentionedFiles).toEqual(["src/unused.ts"]);
    expect(doc.coverageRatio).toBe(0.67);
  });

  it("flags references to non-existent files as invalid", () => {
    const raw = {
      summary: "Invalid walkthrough",
      sections: [
        {
          title: "Phantom file",
          intent: "Imaginary fix",
          description: "Refers to a file that wasn't modified",
          references: [
            {
              path: "src/hallucinated.ts",
              startLine: 1,
              endLine: 10,
            },
          ],
        },
      ],
    };

    const doc = validateWalkthrough(raw, ["src/actual.ts"]);
    expect(doc.isValid).toBe(false);
    expect(doc.sections[0].references[0].status).toBe("invalid");
    expect(doc.sections[0].references[0].invalidReason).toContain(
      "not part of the changed file set",
    );
  });

  it("flags out-of-bounds line numbers as invalid", () => {
    const raw = {
      summary: "Out of bounds",
      sections: [
        {
          title: "Bad lines",
          intent: "Test bounds",
          description: "Range exceeds file length",
          references: [
            {
              path: "src/small.ts",
              startLine: 50,
              endLine: 150,
            },
          ],
        },
      ],
    };

    const doc = validateWalkthrough(raw, ["src/small.ts"], {
      "src/small.ts": { lineCount: 30 },
    });
    expect(doc.isValid).toBe(false);
    expect(doc.sections[0].references[0].status).toBe("invalid");
    expect(doc.sections[0].references[0].invalidReason).toContain("exceeds file length");
  });
});
