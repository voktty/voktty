import { describe, expect, it } from "vitest";
import type { WalkthroughDocument } from "../types";
import { exportWalkthroughToMarkdown } from "./walkthroughExport";

describe("walkthroughExport", () => {
  it("formats walkthrough document into clean markdown", () => {
    const doc: WalkthroughDocument = {
      id: "wt_1",
      title: "Feature Walkthrough",
      summary: "Refactored review subsystem",
      sections: [
        {
          id: "s1",
          title: "Core Models",
          intent: "Data layer update",
          description: "Added LineRange model",
          references: [
            {
              path: "src/models.ts",
              startLine: 1,
              endLine: 15,
              label: "Types",
              status: "valid",
            },
          ],
          risks: ["Check serialization compatibility"],
        },
      ],
      unmentionedFiles: ["src/extra.ts"],
      totalChangedFiles: 2,
      coverageRatio: 0.5,
      isValid: true,
      createdAt: 1000,
    };

    const md = exportWalkthroughToMarkdown(doc);
    expect(md).toContain("# Feature Walkthrough");
    expect(md).toContain("> **Coverage:** 50%");
    expect(md).toContain("### Core Models");
    expect(md).toContain("`src/models.ts#L1-L15` ✓ — *Types*");
    expect(md).toContain("- Check serialization compatibility");
    expect(md).toContain("- `src/extra.ts`");
  });
});
