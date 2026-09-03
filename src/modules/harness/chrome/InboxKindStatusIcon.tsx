import {
  CancelCircle,
  CheckmarkCircle,
  CircleDot,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "./icons";
import {
  inboxItemStatus,
  type InboxKind,
  type InboxProvider,
} from "../lib/githubTasks";

type Props = {
  kind: InboxKind;
  state?: string;
  draft?: boolean;
  stateType?: string;
  provider?: InboxProvider;
  className?: string;
};

export function InboxKindStatusIcon({
  kind,
  state = "",
  draft = false,
  stateType,
  provider = "github",
  className = "size-3 shrink-0",
}: Props) {
  const status = inboxItemStatus({
    kind,
    state,
    draft,
    stateType,
  });

  if (kind === "pr") {
    if (status === "Merged") {
      return (
        <GitMerge
          className={`${className} text-purple-400 dark:text-purple-400`}
          strokeWidth={1.75}
        />
      );
    }
    if (status === "Closed") {
      return (
        <GitPullRequestClosed
          className={`${className} text-red-500 dark:text-red-400`}
          strokeWidth={1.75}
        />
      );
    }
    if (status === "Draft") {
      return (
        <GitPullRequestDraft
          className={`${className} text-content/45`}
          strokeWidth={1.75}
        />
      );
    }
    return (
      <GitPullRequest
        className={`${className} text-emerald-500 dark:text-emerald-400`}
        strokeWidth={1.75}
      />
    );
  }

  if (kind === "linear" || provider === "linear") {
    const st = stateType?.toLowerCase();
    if (st === "completed") {
      return (
        <CheckmarkCircle
          className={`${className} text-emerald-500 dark:text-emerald-400`}
          strokeWidth={1.75}
        />
      );
    }
    if (st === "canceled") {
      return (
        <CancelCircle
          className={`${className} text-red-500 dark:text-red-400`}
          strokeWidth={1.75}
        />
      );
    }
    if (st === "started") {
      return (
        <CircleDot
          className={`${className} text-amber-500 dark:text-amber-400`}
          strokeWidth={1.75}
        />
      );
    }
    return (
      <CircleDot
        className={`${className} text-content/45`}
        strokeWidth={1.75}
      />
    );
  }

  if (status === "Closed") {
    return (
      <CancelCircle
        className={`${className} text-red-500 dark:text-red-400`}
        strokeWidth={1.75}
      />
    );
  }

  return (
    <CircleDot
      className={`${className} text-emerald-500 dark:text-emerald-400`}
      strokeWidth={1.75}
    />
  );
}
