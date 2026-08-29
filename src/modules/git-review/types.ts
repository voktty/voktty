export type LineRange = {
  startLine: number;
  endLine: number;
};

export type ReviewSource =
  | { kind: "file" }
  | {
      kind: "range";
      blockId: string;
      blockLabel: string;
    };

export type ReviewClaim = {
  id: string;
  sessionId: string;
  path: string;
  source: ReviewSource;
  snapshotHash: string;
  snapshotContent?: string;
  ranges: LineRange[] | null;
  viewedAt: number;
};

export type ReviewRange = {
  startLine: number;
  endLine: number;
  status: "reviewed" | "new";
  reviewedVia: ReviewSource | null;
};

export type Reconciliation = {
  changedSinceReview: boolean;
  ranges: ReviewRange[];
  reviewedBaseline: string | null;
};

export type ReviewSession = {
  id: string;
  sessionKey: string;
  repoRoot: string;
  target: string;
  baseRef: string | null;
  headRef: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
};

export type FileReviewState = {
  path: string;
  reviewed: boolean;
  viewedAt: number | null;
  snapshotHash: string | null;
  claimsCount: number;
};

export type SessionReviewOverview = {
  sessionId: string;
  repoRoot: string;
  target: string;
  files: FileReviewState[];
};

export type MarkRangePayload = {
  repoRoot: string;
  target: string;
  path: string;
  blockId: string;
  blockLabel: string;
  content: string;
  ranges: LineRange[];
};
