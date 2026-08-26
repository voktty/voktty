"use client";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import type { LanguageModelUsage } from "ai";
import type { ComponentProps } from "react";
import { createContext, useContext, useMemo } from "react";

const PERCENT_MAX = 100;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;

interface ContextSchema {
  usedTokens: number;
  maxTokens: number;
  usage?: LanguageModelUsage;
}

const ContextContext = createContext<ContextSchema | null>(null);

const useContextValue = () => {
  const context = useContext(ContextContext);

  if (!context) {
    throw new Error("Context components must be used within Context");
  }

  return context;
};

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export const Context = ({
  usedTokens,
  maxTokens,
  usage,
  ...props
}: ContextProps) => {
  const contextValue = useMemo(
    () => ({ maxTokens, usage, usedTokens }),
    [maxTokens, usage, usedTokens]
  );

  return (
    <ContextContext.Provider value={contextValue}>
      <HoverCard closeDelay={0} openDelay={0} {...props} />
    </ContextContext.Provider>
  );
};

const ContextIcon = () => {
  const { t } = useTranslation();
  const { usedTokens, maxTokens } = useContextValue();
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const usedPercent = maxTokens > 0 ? Math.min(1, Math.max(0, usedTokens / maxTokens)) : 0;
  const dashOffset = circumference * (1 - usedPercent);

  return (
    <svg
      aria-label={t("tooltips.modelContextUsage")}
      height="13"
      role="img"
      style={{ color: "currentColor" }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="13"
      className="shrink-0"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.85"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
};

export type ContextTriggerProps = ComponentProps<typeof Button>;

export const ContextTrigger = ({ children, className, ...props }: ContextTriggerProps) => {
  const { usedTokens, maxTokens } = useContextValue();
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0;
  const renderedPercent = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(usedPercent);

  return (
    <HoverCardTrigger asChild>
      {children ?? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn("h-6 gap-1 px-1.5 text-[10.5px] font-mono text-muted-foreground hover:text-foreground shrink-0", className)}
          {...props}
        >
          <span>
            {renderedPercent}
          </span>
          <ContextIcon />
        </Button>
      )}
    </HoverCardTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({
  className,
  ...props
}: ContextContentProps) => (
  <HoverCardContent
    className={cn("min-w-60 divide-y overflow-hidden p-0", className)}
    {...props}
  />
);

export type ContextContentHeaderProps = ComponentProps<"div">;

export const ContextContentHeader = ({
  children,
  className,
  ...props
}: ContextContentHeaderProps) => {
  const { usedTokens, maxTokens } = useContextValue();
  const usedPercent = usedTokens / maxTokens;
  const displayPct = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(usedPercent);
  const used = new Intl.NumberFormat("en-US", {
    notation: "compact",
  }).format(usedTokens);
  const total = new Intl.NumberFormat("en-US", {
    notation: "compact",
  }).format(maxTokens);

  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{displayPct}</p>
            <p className="font-mono text-muted-foreground">
              {used} / {total}
            </p>
          </div>
          <div className="space-y-2">
            <Progress className="bg-muted" value={usedPercent * PERCENT_MAX} />
          </div>
        </>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<"div">;

export const ContextContentBody = ({
  children,
  className,
  ...props
}: ContextContentBodyProps) => (
  <div className={cn("w-full p-3", className)} {...props}>
    {children}
  </div>
);

export type ContextContentFooterProps = ComponentProps<"div">;

export const ContextContentFooter = ({
  children,
  className,
  ...props
}: ContextContentFooterProps) => (
  <div
    className={cn(
      "flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

const formatTokenCount = (tokens?: number) =>
  tokens === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { notation: "compact" }).format(tokens);

const UsageRow = ({
  label,
  tokens,
  className,
  ...props
}: ComponentProps<"div"> & { label: string; tokens: number }) => (
  <div
    className={cn("flex items-center justify-between text-xs", className)}
    {...props}
  >
    <span className="text-muted-foreground">{label}</span>
    <span>{formatTokenCount(tokens)}</span>
  </div>
);

export type ContextInputUsageProps = ComponentProps<"div">;

export const ContextInputUsage = ({
  children,
  ...props
}: ContextInputUsageProps) => {
  const { t } = useTranslation();
  const { usage } = useContextValue();
  const inputTokens = usage?.inputTokens ?? 0;

  if (children) {
    return children;
  }

  if (!inputTokens) {
    return null;
  }

  return <UsageRow label={t("ai.tools.labels.input")} tokens={inputTokens} {...props} />;
};

export type ContextOutputUsageProps = ComponentProps<"div">;

export const ContextOutputUsage = ({
  children,
  ...props
}: ContextOutputUsageProps) => {
  const { t } = useTranslation();
  const { usage } = useContextValue();
  const outputTokens = usage?.outputTokens ?? 0;

  if (children) {
    return children;
  }

  if (!outputTokens) {
    return null;
  }

  return <UsageRow label={t("ai.tools.labels.output")} tokens={outputTokens} {...props} />;
};

export type ContextReasoningUsageProps = ComponentProps<"div">;

export const ContextReasoningUsage = ({
  children,
  ...props
}: ContextReasoningUsageProps) => {
  const { t } = useTranslation();
  const { usage } = useContextValue();
  const reasoningTokens = usage?.reasoningTokens ?? 0;

  if (children) {
    return children;
  }

  if (!reasoningTokens) {
    return null;
  }

  return <UsageRow label={t("tooltips.reasoning")} tokens={reasoningTokens} {...props} />;
};

export type ContextCacheUsageProps = ComponentProps<"div">;

export const ContextCacheUsage = ({
  children,
  ...props
}: ContextCacheUsageProps) => {
  const { t } = useTranslation();
  const { usage } = useContextValue();
  const cacheTokens = usage?.cachedInputTokens ?? 0;

  if (children) {
    return children;
  }

  if (!cacheTokens) {
    return null;
  }

  return <UsageRow label={t("tooltips.cache")} tokens={cacheTokens} {...props} />;
};
