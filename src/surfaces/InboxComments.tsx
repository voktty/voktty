import { openUrl } from "@tauri-apps/plugin-opener";
import { LoaderCircle } from "../chrome/icons";
import {
  formatRelativeTime,
  githubReviewStateLabel,
  inboxPersonAvatarUrl,
  type GithubWorkItemComment,
  type GithubWorkItemThread,
} from "../lib/githubTasks";
import { AgentMarkdown } from "./AgentMarkdown";
import { useEffect, useState } from "react";

type Props = {
  thread: GithubWorkItemThread | null;
  loading: boolean;
  error: string | null;
  cwd: string;
};

export function InboxComments({ thread, loading, error, cwd }: Props) {
  if (thread && thread.comments.length === 0 && !thread.truncated) {
    if (loading) return <CommentsPending />;
    return null;
  }
  if (!thread) {
    if (error) {
      return <p className="text-[12px] text-content/45">{error}</p>;
    }
    if (loading) return <CommentsPending />;
    return null;
  }

  const count = thread.comments.reduce(
    (total, comment) => total + 1 + comment.replies.length,
    0,
  );
  const label = count === 1 ? "1 comment" : `${count} comments`;

  return (
    <section className="flex flex-col gap-3 border-t border-content/10 pt-5">
      <div className="flex items-center gap-2 text-[12px] text-content/50">
        <h2 className="text-content/70">{label}</h2>
        {thread.truncated ? (
          <span>Latest comments · more on GitHub</span>
        ) : null}
        {loading ? (
          <LoaderCircle
            className="size-3 animate-spin text-content/35"
            strokeWidth={1.75}
          />
        ) : null}
      </div>
      {error ? <p className="text-[12px] text-content/45">{error}</p> : null}
      <ol className="flex flex-col gap-2">
        {thread.comments.map((comment) => (
          <li key={comment.id}>
            <InboxComment comment={comment} cwd={cwd} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function CommentsPending() {
  return (
    <div className="flex items-center gap-2 border-t border-content/10 pt-5 text-[12px] text-content/45">
      <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
      Loading comments
    </div>
  );
}

function InboxComment({
  comment,
  cwd,
  nested = false,
}: {
  comment: GithubWorkItemComment;
  cwd: string;
  nested?: boolean;
}) {
  const time = formatRelativeTime(comment.createdAt);
  const review = githubReviewStateLabel(comment.state);
  const location = commentLocation(comment);
  const meta = [
    review,
    location,
    comment.resolved ? "Resolved" : "",
    time,
  ].filter((part) => part.length > 0);
  const hasBody = comment.body.trim().length > 0;
  const hasReplies = !nested && comment.replies.length > 0;

  const inner = (
    <>
      <header
        className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-content/50 ${
          nested ? "" : "px-3 py-2"
        } ${!nested && (hasBody || hasReplies) ? "border-b border-content/10" : ""}`}
      >
        <InboxCommentPerson
          name={comment.author || "ghost"}
          avatarUrl={inboxPersonAvatarUrl(
            "github",
            comment.author,
            comment.authorAvatarUrl,
          )}
        />
        {meta.map((part, index) => (
          <span
            key={`${part}-${index}`}
            className="flex min-w-0 items-center gap-2"
          >
            <span aria-hidden>·</span>
            {comment.url && part === time ? (
              <button
                type="button"
                title="Open on GitHub"
                onClick={() => void openUrl(comment.url)}
                className="hover:text-content"
              >
                {part}
              </button>
            ) : (
              <span
                className={
                  comment.state === "APPROVED"
                    ? "text-emerald-400/90"
                    : comment.state === "CHANGES_REQUESTED"
                      ? "text-rose-400/90"
                      : comment.resolved && part === "Resolved"
                        ? "text-emerald-400/80"
                        : "min-w-0 truncate"
                }
              >
                {part}
              </span>
            )}
          </span>
        ))}
      </header>
      {hasBody ? (
        <div className={nested ? "mt-2" : "px-3 py-2.5"}>
          <AgentMarkdown
            className="inbox-comment-md"
            text={comment.body}
            cwd={cwd}
          />
        </div>
      ) : null}
      {hasReplies ? (
        <div className="border-t border-content/10 px-3">
          {comment.replies.map((reply, index) => (
            <div
              key={reply.id}
              className={`py-2.5 ${
                index > 0 ? "border-t border-content/10" : ""
              }`}
            >
              <InboxComment comment={reply} cwd={cwd} nested />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );

  if (nested) return <article>{inner}</article>;
  return (
    <article className="overflow-hidden rounded-md border border-content/10 bg-content/5">
      {inner}
    </article>
  );
}

function commentLocation(comment: GithubWorkItemComment): string {
  const path = comment.path.trim();
  if (!path) return "";
  if (comment.line && comment.line > 0) return `${path}:${comment.line}`;
  return path;
}

function InboxCommentPerson({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string;
}) {
  const [failed, setFailed] = useState(!avatarUrl);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    setFailed(!avatarUrl);
  }, [avatarUrl]);

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          width={20}
          height={20}
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-5 shrink-0 rounded-full bg-content/10 object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-full bg-content/12 text-[10px] font-medium text-content/55"
        >
          {initial}
        </span>
      )}
      <span className="min-w-0 truncate font-medium text-content">{name}</span>
    </span>
  );
}
