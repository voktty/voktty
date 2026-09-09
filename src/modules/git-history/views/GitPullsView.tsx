import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import {
  detectGithubRepo,
  getGithubPrDiff,
  getGithubToken,
  isGithubConnected,
  listGithubPullRequests,
  setGithubToken,
  submitGithubReview,
  type GithubPrDiff,
  type GithubPullRequest,
  type ReviewEvent,
} from "@/modules/git-review/lib/githubProvider";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Download01Icon,
  GitCompareIcon,
  GitPullRequestIcon,
  Key01Icon,
  LayoutTwoColumnIcon,
  LinkSquare02Icon,
  Message01Icon,
  Refresh01Icon,
  Search01Icon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CommitDiffOpenInput } from "../types";

type Props = {
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
  onOpenCommitDiff?: (input: CommitDiffOpenInput) => void;
};

function relativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function authorInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const AUTHOR_TINTS = [
  "#7aa2f7",
  "#bb9af7",
  "#9ece6a",
  "#e0af68",
  "#f7768e",
  "#73daca",
  "#ff9e64",
  "#b4f9f8",
];

function authorTint(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AUTHOR_TINTS[Math.abs(hash) % AUTHOR_TINTS.length];
}

export const GitPullsView = memo(function GitPullsView({
  repoRoot,
  workspaceEnv,
  onOpenCommitDiff,
}: Props) {
  const { t } = useTranslation();
  const [ownerRepo, setOwnerRepo] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [pulls, setPulls] = useState<GithubPullRequest[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);

  // Review dialog state
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent>("APPROVE");
  const [reviewBody, setReviewBody] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // Selected PR diff state
  const [prDiff, setPrDiff] = useState<GithubPrDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const initDetection = useCallback(async () => {
    try {
      setLoading(true);
      const [detected, connected] = await Promise.all([
        detectGithubRepo(repoRoot),
        isGithubConnected(),
      ]);
      setOwnerRepo(detected);
      setIsConnected(connected);

      if (detected && connected) {
        const list = await listGithubPullRequests(detected);
        setPulls(list);
        if (list.length > 0 && selectedNumber === null) {
          setSelectedNumber(list[0].number);
        }
      }
    } catch {
      // Degrades gracefully
    } finally {
      setLoading(false);
    }
  }, [repoRoot, selectedNumber]);

  useEffect(() => {
    void initDetection();
  }, [initDetection]);

  const loadPullRequests = useCallback(async () => {
    if (!ownerRepo) return;
    try {
      setLoading(true);
      const list = await listGithubPullRequests(ownerRepo);
      setPulls(list);
      if (list.length > 0 && (!selectedNumber || !list.find((p) => p.number === selectedNumber))) {
        setSelectedNumber(list[0].number);
      }
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to load PRs"
      );
    } finally {
      setLoading(false);
    }
  }, [ownerRepo, selectedNumber]);

  const selectedPr = useMemo(
    () => pulls.find((p) => p.number === selectedNumber) ?? null,
    [pulls, selectedNumber]
  );

  // Load diff when selected PR changes
  useEffect(() => {
    if (!ownerRepo || !selectedNumber) {
      setPrDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    getGithubPrDiff(ownerRepo, selectedNumber)
      .then((res) => {
        if (!cancelled) setPrDiff(res);
      })
      .catch(() => {
        if (!cancelled) setPrDiff(null);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerRepo, selectedNumber]);

  const handleSaveToken = useCallback(async () => {
    if (!tokenInput.trim()) return;
    try {
      setSavingToken(true);
      await setGithubToken(tokenInput.trim());
      setIsConnected(true);
      setTokenDialogOpen(false);
      setTokenInput("");
      toast.success(t("gitHistory.pulls.tokenSaved"));
      void initDetection();
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Failed to save token"
      );
    } finally {
      setSavingToken(false);
    }
  }, [initDetection, t, tokenInput]);

  const handleCheckout = useCallback(
    async (pr: GithubPullRequest) => {
      try {
        setCheckingOut(true);
        await native.gitCheckoutBranch(repoRoot, pr.headRef, workspaceEnv);
        toast.success(
          t("gitHistory.branches.checkoutSuccess", { branch: pr.headRef })
        );
      } catch (err) {
        toast.error(
          typeof err === "string"
            ? err
            : (err as Error).message || "Failed to checkout PR branch"
        );
      } finally {
        setCheckingOut(false);
      }
    },
    [repoRoot, t, workspaceEnv]
  );

  const handleSubmitReview = useCallback(async () => {
    if (!ownerRepo || !selectedPr) return;
    try {
      setSubmittingReview(true);
      await submitGithubReview({
        ownerRepo,
        number: selectedPr.number,
        commitId: selectedPr.headSha,
        event: reviewEvent,
        body: reviewBody.trim() || undefined,
      });
      toast.success(t("gitHistory.pulls.reviewSubmitted"));
      setReviewDialogOpen(false);
      setReviewBody("");
      void loadPullRequests();
    } catch (err) {
      toast.error(
        typeof err === "string"
          ? err
          : (err as Error).message || "Failed to submit review"
      );
    } finally {
      setSubmittingReview(false);
    }
  }, [loadPullRequests, ownerRepo, reviewBody, reviewEvent, selectedPr, t]);

  const filteredPulls = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return pulls;
    return pulls.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        p.headRef.toLowerCase().includes(q) ||
        String(p.number).includes(q)
    );
  }, [pulls, searchQuery]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden select-none text-xs">
      {/* Header bar */}
      <div className="flex items-center justify-between p-3 border-b border-border/40 gap-2 font-mono">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <HugeiconsIcon
              icon={Search01Icon}
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("gitHistory.pulls.searchPlaceholder")}
              className="h-7 pl-8 text-xs font-sans"
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={loadPullRequests}
            disabled={loading || !isConnected}
            className="h-7 px-2.5 gap-1.5 font-sans"
          >
            <HugeiconsIcon
              icon={Refresh01Icon}
              size={13}
              className={cn(loading && "animate-spin")}
            />
            <span>{t("gitHistory.pulls.refresh")}</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {ownerRepo && (
            <span className="text-[11px] text-muted-foreground px-2 py-0.5 rounded bg-muted/20">
              {ownerRepo}
            </span>
          )}

          {!isConnected && (
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setTokenDialogOpen(true);
                void getGithubToken().then((t) => {
                  if (t) setTokenInput(t);
                });
              }}
              className="h-7 px-2.5 gap-1.5 font-sans"
            >
              <HugeiconsIcon icon={Key01Icon} size={13} />
              <span>{t("gitHistory.pulls.connectGithub")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      {!isConnected ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center gap-3">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <HugeiconsIcon icon={GitPullRequestIcon} size={22} />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="font-semibold text-sm">
              {t("gitHistory.pulls.tokenRequiredTitle")}
            </h3>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("gitHistory.pulls.tokenRequiredDesc")}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setTokenDialogOpen(true)}
            className="gap-1.5 h-8 px-4"
          >
            <HugeiconsIcon icon={Key01Icon} size={14} />
            <span>{t("gitHistory.pulls.setTokenBtn")}</span>
          </Button>
        </div>
      ) : !ownerRepo ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center gap-3 text-muted-foreground">
          <HugeiconsIcon icon={GitPullRequestIcon} size={32} className="opacity-40" />
          <p>{t("gitHistory.pulls.noRemoteFound")}</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden divide-x divide-border/40">
          {/* PR List Pane (Left) */}
          <div className="w-80 shrink-0 flex flex-col min-h-0 bg-card/10 overflow-y-auto">
            {loading && pulls.length === 0 ? (
              <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>{t("gitHistory.pulls.loading")}</span>
              </div>
            ) : filteredPulls.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                {t("gitHistory.pulls.noPulls")}
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {filteredPulls.map((pr) => {
                  const isSelected = pr.number === selectedNumber;
                  const initials = authorInitials(pr.author);
                  return (
                    <button
                      key={pr.number}
                      type="button"
                      onClick={() => setSelectedNumber(pr.number)}
                      className={cn(
                        "flex flex-col gap-1.5 p-3 w-full text-left transition-colors cursor-pointer",
                        isSelected
                          ? "bg-accent/50 border-l-2 border-l-primary"
                          : "hover:bg-accent/20"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono font-semibold text-primary text-[11px]">
                          #{pr.number}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {relativeTime(pr.updatedAt)}
                        </span>
                      </div>

                      <div className="font-medium text-foreground text-[12px] line-clamp-2 leading-snug">
                        {pr.title}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-0.5 text-[10.5px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] font-mono text-[8.5px] font-bold uppercase text-background"
                            style={{
                              backgroundColor: authorTint(pr.author),
                            }}
                          >
                            {initials}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {pr.author}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground shrink-0">
                          <span className="truncate max-w-[70px]">{pr.headRef}</span>
                          <HugeiconsIcon icon={ArrowRight01Icon} size={10} />
                          <span className="truncate max-w-[70px]">{pr.baseRef}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* PR Detail Pane (Right) */}
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto bg-background p-4 space-y-4">
            {selectedPr ? (
              <>
                {/* PR Header */}
                <div className="space-y-2 border-b border-border/40 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-bold text-primary">
                          #{selectedPr.number}
                        </span>
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wider",
                            selectedPr.state === "open"
                              ? "bg-emerald-500/15 text-emerald-500"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {selectedPr.state}
                        </span>
                        {selectedPr.draft && (
                          <span className="px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-500">
                            {t("gitHistory.pulls.draftBadge")}
                          </span>
                        )}
                      </div>
                      <h2 className="text-base font-semibold text-foreground leading-snug">
                        {selectedPr.title}
                      </h2>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void openUrl(selectedPr.htmlUrl).catch(console.error)
                        }
                        className="h-7 gap-1.5 px-2 text-xs"
                      >
                        <HugeiconsIcon icon={LinkSquare02Icon} size={13} />
                        <span>{t("gitHistory.pulls.openInBrowser")}</span>
                      </Button>
                    </div>
                  </div>

                  {/* Metadata cards */}
                  <div className="grid grid-cols-4 gap-2 pt-2 text-[11px] font-mono">
                    <div className="p-2 rounded bg-muted/20 border border-border/30">
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground block">
                        {t("gitHistory.headers.author")}
                      </span>
                      <span className="font-semibold truncate block mt-0.5">
                        {selectedPr.author}
                      </span>
                    </div>

                    <div className="p-2 rounded bg-muted/20 border border-border/30">
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground block">
                        {t("gitHistory.pulls.headBranch")}
                      </span>
                      <span className="font-semibold truncate block mt-0.5">
                        {selectedPr.headRef}
                      </span>
                    </div>

                    <div className="p-2 rounded bg-muted/20 border border-border/30">
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground block">
                        {t("gitHistory.pulls.baseBranch")}
                      </span>
                      <span className="font-semibold truncate block mt-0.5">
                        {selectedPr.baseRef}
                      </span>
                    </div>

                    <div className="p-2 rounded bg-muted/20 border border-border/30">
                      <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground block">
                        {t("gitHistory.headers.date")}
                      </span>
                      <span className="font-semibold truncate block mt-0.5">
                        {relativeTime(selectedPr.updatedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Action Bar */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleCheckout(selectedPr)}
                      disabled={checkingOut}
                      className="h-7 gap-1.5 text-xs font-sans"
                    >
                      <HugeiconsIcon icon={Download01Icon} size={13} />
                      <span>{t("gitHistory.pulls.checkoutPrBranch")}</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onOpenCommitDiff?.({
                          repoRoot,
                          sha: selectedPr.headSha,
                          shortSha: selectedPr.headSha.slice(0, 7),
                          subject: `PR #${selectedPr.number}: ${selectedPr.title}`,
                          workspaceEnv,
                        })
                      }
                      className="h-7 gap-1.5 text-xs font-sans"
                    >
                      <HugeiconsIcon icon={GitCompareIcon} size={13} />
                      <span>{t("gitHistory.pulls.viewDiff")}</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onOpenCommitDiff?.({
                          repoRoot,
                          sha: selectedPr.headSha,
                          shortSha: selectedPr.headSha.slice(0, 7),
                          subject: `PR #${selectedPr.number}: ${selectedPr.title}`,
                          workspaceEnv,
                          split: true,
                        })
                      }
                      className="h-7 gap-1.5 text-xs font-sans"
                    >
                      <HugeiconsIcon icon={LayoutTwoColumnIcon} size={13} />
                      <span>{t("gitHistory.pulls.openSplitDiff")}</span>
                    </Button>

                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setReviewDialogOpen(true)}
                      className="h-7 gap-1.5 text-xs font-sans ml-auto"
                    >
                      <HugeiconsIcon icon={Message01Icon} size={13} />
                      <span>{t("gitHistory.pulls.reviewPr")}</span>
                    </Button>
                  </div>
                </div>

                {/* Diff Viewer section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>{t("gitHistory.pulls.diffPreview")}</span>
                    {prDiff?.truncated && (
                      <span className="text-amber-500 font-normal">
                        ({t("gitHistory.patchTruncated")})
                      </span>
                    )}
                  </div>

                  {diffLoading ? (
                    <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                      <Spinner className="size-3.5" />
                      <span>{t("gitHistory.pulls.loadingDiff")}</span>
                    </div>
                  ) : prDiff ? (
                    <pre className="p-3 rounded-lg border border-border/40 bg-card/20 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-96 text-foreground/90 whitespace-pre">
                      {prDiff.diff || t("gitHistory.noFileChanges")}
                    </pre>
                  ) : (
                    <div className="p-6 text-center text-muted-foreground border border-dashed border-border/40 rounded-lg">
                      {t("gitHistory.pulls.diffUnavailable")}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <HugeiconsIcon icon={GitPullRequestIcon} size={32} className="opacity-40 mb-2" />
                <p>{t("gitHistory.pulls.selectPrHint")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* GitHub Token Config Dialog */}
      <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("gitHistory.pulls.connectGithubTitle")}</DialogTitle>
            <DialogDescription>
              {t("gitHistory.pulls.connectGithubDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={savingToken}
              onClick={() => setTokenDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={savingToken || !tokenInput.trim()}
              onClick={handleSaveToken}
            >
              {savingToken ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Submission Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("gitHistory.pulls.submitReviewTitle", {
                number: selectedPr?.number ?? 0,
              })}
            </DialogTitle>
            <DialogDescription>
              {selectedPr?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={reviewEvent === "APPROVE" ? "default" : "outline"}
                size="sm"
                onClick={() => setReviewEvent("APPROVE")}
                className="gap-1.5 h-8 text-xs font-medium"
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} />
                <span>{t("gitHistory.pulls.approve")}</span>
              </Button>
              <Button
                type="button"
                variant={reviewEvent === "COMMENT" ? "default" : "outline"}
                size="sm"
                onClick={() => setReviewEvent("COMMENT")}
                className="gap-1.5 h-8 text-xs font-medium"
              >
                <HugeiconsIcon icon={Message01Icon} size={13} />
                <span>{t("gitHistory.pulls.comment")}</span>
              </Button>
              <Button
                type="button"
                variant={reviewEvent === "REQUEST_CHANGES" ? "destructive" : "outline"}
                size="sm"
                onClick={() => setReviewEvent("REQUEST_CHANGES")}
                className="gap-1.5 h-8 text-xs font-medium"
              >
                <HugeiconsIcon icon={UnavailableIcon} size={13} />
                <span>{t("gitHistory.pulls.requestChanges")}</span>
              </Button>
            </div>

            <Textarea
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              placeholder={t("gitHistory.pulls.reviewBodyPlaceholder")}
              rows={4}
              className="text-xs font-sans resize-none"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={submittingReview}
              onClick={() => setReviewDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={submittingReview}
              onClick={handleSubmitReview}
            >
              {submittingReview ? t("common.loading") : t("gitHistory.pulls.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
