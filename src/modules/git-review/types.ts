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

export type WalkthroughReferenceStatus = "valid" | "invalid" | "unverified";

export type WalkthroughReference = {
  path: string;
  startLine: number;
  endLine: number;
  label?: string;
  status: WalkthroughReferenceStatus;
  invalidReason?: string;
};

export type WalkthroughSection = {
  id: string;
  title: string;
  intent: string;
  description: string;
  references: WalkthroughReference[];
  risks?: string[];
};

export type WalkthroughDocument = {
  id: string;
  title: string;
  summary: string;
  sections: WalkthroughSection[];
  unmentionedFiles: string[];
  totalChangedFiles: number;
  coverageRatio: number;
  isValid: boolean;
  createdAt: number;
};

export type ReviewComment = {
  id: string;
  sessionId: string;
  path: string;
  side: "old" | "new";
  line: number;
  endLine?: number;
  snapshotHash: string;
  comment: string;
  createdAt: number;
  updatedAt: number;
  status: "pending" | "resolved" | "submitted";
};

export type AddReviewCommentPayload = {
  repoRoot: string;
  target: string;
  path: string;
  side: "old" | "new";
  line: number;
  endLine?: number;
  content: string;
  comment: string;
};

export type ReviewHandoffSummary = {
  repoRoot: string;
  target: string;
  totalReviewedFiles: number;
  totalChangedFiles: number;
  comments: ReviewComment[];
  markdownPrompt: string;
};


