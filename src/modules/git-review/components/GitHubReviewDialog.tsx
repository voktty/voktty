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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { openExternalUrl } from "@/lib/external-link";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Comment01Icon,
  GithubIcon,
  RefreshIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  clearGithubToken,
  detectGithubRepo,
  getGithubPrDiff,
  isGithubConnected,
  listGithubPullRequests,
  setGithubToken,
  submitGithubReview,
  type GithubPrDiff,
  type GithubPullRequest,
  type ReviewEvent,
} from "../lib/githubProvider";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string;
};

type Stage = "loading" | "connect" | "list" | "review";

export function GitHubReviewDialog({ open, onOpenChange, repoRoot }: Props) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [ownerRepo, setOwnerRepo] = useState<string | null>(null);
  const [prs, setPrs] = useState<GithubPullRequest[]>([]);
  const [selected, setSelected] = useState<GithubPullRequest | null>(null);
  const [diff, setDiff] = useState<GithubPrDiff | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPrs = useCallback(async (repo: string) => {
    setBusy(true);
    setError(null);
    try {
      const list = await listGithubPullRequests(repo);
      setPrs(list);
      setStage("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("list");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStage("loading");
    setSelected(null);
    setDiff(null);
    setReviewBody("");
    void (async () => {
      const connected = await isGithubConnected();
      if (!connected) {
        setStage("connect");
        return;
      }
      const repo = await detectGithubRepo(repoRoot);
      setOwnerRepo(repo);
      if (!repo) {
        setError(t("git.githubNoRemote"));
        setStage("list");
        setPrs([]);
        return;
      }
      await loadPrs(repo);
    })();
  }, [open, repoRoot, t, loadPrs]);

  const handleConnect = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await setGithubToken(trimmed);
      setTokenInput("");
      const repo = await detectGithubRepo(repoRoot);
      setOwnerRepo(repo);
      if (!repo) {
        setError(t("git.githubNoRemote"));
        setStage("list");
        return;
      }
      await loadPrs(repo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    await clearGithubToken();
    setOwnerRepo(null);
    setPrs([]);
    setStage("connect");
  };

  const openPr = async (pr: GithubPullRequest) => {
    if (!ownerRepo) return;
    setSelected(pr);
    setDiff(null);
    setError(null);
    setBusy(true);
    try {
      const result = await getGithubPrDiff(ownerRepo, pr.number);
      setDiff(result);
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitReview = async (event: ReviewEvent) => {
    if (!ownerRepo || !selected || !diff) return;
    if (event === "REQUEST_CHANGES" && !reviewBody.trim()) {
      toast.error(t("git.githubReviewBodyRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitGithubReview({
        ownerRepo,
        number: selected.number,
        commitId: diff.headSha,
        event,
        body: reviewBody.trim() || undefined,
      });
      toast.success(t("git.githubReviewSubmitted"));
      onOpenChange(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={GithubIcon} size={18} strokeWidth={1.9} />
            <DialogTitle className="text-base font-semibold">
              {t("git.githubReviewTitle")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {ownerRepo
              ? t("git.githubReviewScope", { repo: ownerRepo })
              : t("git.githubReviewDescription")}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive">
            {error}
          </div>
        ) : null}

        {stage === "loading" ? (
          <div className="flex flex-1 items-center justify-center py-10">
            <Spinner className="size-5" />
          </div>
        ) : null}

        {stage === "connect" ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-[11.5px] text-muted-foreground">
              {t("git.githubConnectHelp")}
            </p>
            <Input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="ghp_..."
              className="h-8 font-mono text-[11.5px]"
            />
            <button
              type="button"
              onClick={() =>
                void openExternalUrl(
                  "https://github.com/settings/tokens/new?scopes=repo&description=Voktty",
                )
              }
              className="self-start text-[11px] text-primary hover:underline"
            >
              {t("git.githubCreateToken")}
            </button>
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                disabled={!tokenInput.trim() || busy}
                onClick={() => void handleConnect()}
                className="gap-1.5 text-xs"
              >
                {busy ? <Spinner className="size-3.5" /> : null}
                {t("git.githubConnect")}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {stage === "list" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {t("git.githubOpenPrs", { count: prs.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[10.5px]"
                  disabled={busy || !ownerRepo}
                  onClick={() => ownerRepo && void loadPrs(ownerRepo)}
                >
                  <HugeiconsIcon icon={RefreshIcon} size={12} />
                  {t("common.refresh")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10.5px] text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDisconnect()}
                >
                  {t("git.githubDisconnect")}
                </Button>
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border/60">
              {busy ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="size-4" />
                </div>
              ) : prs.length === 0 ? (
                <p className="p-4 text-center text-[11.5px] text-muted-foreground">
                  {t("git.githubNoOpenPrs")}
                </p>
              ) : (
                <ul className="divide-y divide-border/40">
                  {prs.map((pr) => (
                    <li key={pr.number}>
                      <button
                        type="button"
                        onClick={() => void openPr(pr)}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="text-[12px] font-medium text-foreground">
                          #{pr.number} {pr.title}
                        </span>
                        <span className="text-[10.5px] text-muted-foreground">
                          {pr.author} · {pr.headRef} → {pr.baseRef}
                          {pr.draft ? ` · ${t("git.githubDraft")}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>
        ) : null}

        {stage === "review" && selected && diff ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10.5px]"
                onClick={() => setStage("list")}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
                {t("common.back")}
              </Button>
              <span className="text-[12px] font-medium">
                #{selected.number} {selected.title}
              </span>
            </div>

            <div className="min-h-0 flex-1 rounded-md border border-border/60 bg-muted/20">
              <ScrollArea className="h-64 sm:h-72 w-full p-3 font-mono text-[10.5px] leading-relaxed">
                <pre className="whitespace-pre-wrap font-mono text-muted-foreground">
                  {diff.diff}
                  {diff.truncated ? `\n\n… ${t("git.githubDiffTruncated")}` : ""}
                </pre>
              </ScrollArea>
            </div>

            <textarea
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              placeholder={t("git.githubReviewBodyPlaceholder")}
              rows={3}
              className="w-full resize-none rounded-md border border-border/60 bg-background/80 p-2 text-[11.5px] focus:border-primary focus:outline-none"
            />

            <DialogFooter className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className={cn("gap-1.5 text-xs")}
                onClick={() => void handleSubmitReview("COMMENT")}
              >
                <HugeiconsIcon icon={Comment01Icon} size={13} />
                {t("git.githubComment")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className="gap-1.5 text-xs text-destructive hover:text-destructive"
                onClick={() => void handleSubmitReview("REQUEST_CHANGES")}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={13} />
                {t("git.githubRequestChanges")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                className="gap-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-600/90"
                onClick={() => void handleSubmitReview("APPROVE")}
              >
                {busy ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} />
                )}
                {t("git.githubApprove")}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
