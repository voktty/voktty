import { CircleDashed, PanelRight } from "./icons";
import { planMeta, planSummary, planTitle } from "../lib/plan";
import { FileTypeIcon } from "./FileTypeIcon";

type Props = {
  text: string;
  streaming?: boolean;
  onOpen?: () => void;
};

export function PlanPreview({ text, streaming, onOpen }: Props) {
  const title = planTitle(text);
  const summary = planSummary(text);
  const meta = streaming ? "Writing…" : planMeta(text).join(" · ");

  return (
    <div className="overflow-hidden rounded-[10px] border border-yellow-200/40 bg-yellow-200/10 border-dashed mb-2">
      <div className="flex items-start gap-2 px-2.5 py-2">
        {streaming ? (
          <CircleDashed
            className="mt-0.5 size-4 shrink-0 text-content/40"
            strokeWidth={1.75}
          />
        ) : (
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            <FileTypeIcon name="plan.md" isDir={false} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button
              type="button"
              className="block w-full truncate text-left font-mono text-[12px] font-medium text-content/85 hover:text-sky-300 hover:underline"
              title={title}
              onClick={onOpen}
            >
              {title}
            </button>
          ) : (
            <span
              className="block truncate font-mono text-[12px] font-medium text-content/85"
              title={title}
            >
              {title}
            </span>
          )}
          {summary ? (
            <p className="mt-0.5 line-clamp-2 font-sans text-[12px] leading-4.5 text-content/50">
              {summary}
            </p>
          ) : null}
          {meta ? (
            <p className="mt-0.5 font-mono text-[11px] text-content/40">
              {meta}
            </p>
          ) : null}
        </div>
        {onOpen ? (
          <button
            type="button"
            title="Open in pane"
            aria-label="Open plan in pane"
            className="mt-0.5 flex h-6 shrink-0 items-center gap-1 rounded-md bg-content/10 px-2 font-mono text-[11px] text-content/70 hover:bg-content/15 hover:text-content"
            onClick={onOpen}
          >
            <PanelRight className="size-3" strokeWidth={1.75} />
            Open
          </button>
        ) : null}
      </div>
    </div>
  );
}
