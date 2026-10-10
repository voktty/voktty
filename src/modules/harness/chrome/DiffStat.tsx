import { t } from "@/modules/i18n";
import { useLayoutEffect, useRef } from "react";

type Props = {
  additions: number;
  deletions: number;
};

export function DiffStat({ additions, deletions }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const label = [
    additions > 0 ? `+${additions}` : "",
    deletions > 0 ? `-${deletions}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const fitToWidth = () => {
      if (!label) return;
      const availableWidth = container.getBoundingClientRect().width;
      if (availableWidth <= 0) return;

      let maxFontSize = 11;
      content.style.fontSize = `${maxFontSize}px`;
      if (content.getBoundingClientRect().width <= availableWidth) return;

      let minFontSize = 0;
      while (maxFontSize - minFontSize > 0.1) {
        const fontSize = (minFontSize + maxFontSize) / 2;
        content.style.fontSize = `${fontSize}px`;
        if (content.getBoundingClientRect().width > availableWidth) {
          maxFontSize = fontSize;
        } else {
          minFontSize = fontSize;
        }
      }
      content.style.fontSize = `${minFontSize}px`;
    };

    fitToWidth();
    const observer = new ResizeObserver(fitToWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [label]);

  if (!label) return null;

  return (
    <span
      ref={containerRef}
      title={t("harness.chrome.uncommittedSummary", { label })}
      className="flex h-full w-full min-w-0 items-center justify-center overflow-hidden"
    >
      <span
        ref={contentRef}
        className="flex shrink-0 items-center gap-[0.55em] whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums"
      >
        {additions > 0 ? (
          <span className="text-diff-add-fg">+{additions}</span>
        ) : null}
        {deletions > 0 ? (
          <span className="text-diff-del-fg">-{deletions}</span>
        ) : null}
      </span>
    </span>
  );
}
