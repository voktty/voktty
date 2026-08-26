import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function SettingRow({ title, description, children, className }: Props) {
  const settingTitle = typeof title === "string" ? title : undefined;

  return (
    <div
      data-setting-row="true"
      data-setting-title={settingTitle}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-2.5 py-2 transition-shadow data-[settings-search-highlight=true]:border-primary/70 data-[settings-search-highlight=true]:ring-2 data-[settings-search-highlight=true]:ring-primary/30",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11.5px] font-medium text-foreground">{title}</span>
        {description ? (
          <span className="text-[10px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
