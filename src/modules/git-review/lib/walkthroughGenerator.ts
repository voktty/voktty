import type { WalkthroughDocument } from "../types";
import { validateWalkthrough } from "./walkthroughValidator";

export type SyntheticWalkthroughOptions = {
  title?: string;
  summary?: string;
  intent?: string;
  hunkLabel?: string;
};

export function generateSyntheticWalkthrough(
  changedFiles: readonly string[],
  options?: SyntheticWalkthroughOptions,
): WalkthroughDocument {
  const rawSections = changedFiles.map((file, idx) => ({
    id: `sec_${idx + 1}`,
    title: file.split("/").pop() ?? file,
    intent: options?.intent ?? "Git",
    description: file,
    references: [
      {
        path: file,
        startLine: 1,
        endLine: 30,
        label: options?.hunkLabel,
      },
    ],
    risks: [],
  }));

  return validateWalkthrough(
    {
      title: options?.title ?? "Git",
      summary: options?.summary ?? "Git",
      sections: rawSections,
    },
    changedFiles,
  );
}
