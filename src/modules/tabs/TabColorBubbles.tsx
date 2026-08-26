import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";

export const TAB_PALETTE = [
  { key: "red", value: "#ef4444" },
  { key: "amber", value: "#f59e0b" },
  { key: "emerald", value: "#10b981" },
  { key: "cyan", value: "#06b6d4" },
  { key: "blue", value: "#3b82f6" },
  { key: "purple", value: "#8b5cf6" },
  { key: "pink", value: "#ec4899" },
] as const;

export type TabColorBubblesProps = {
  currentColor?: string | null;
  onSelectColor: (color: string | null) => void;
  className?: string;
  size?: "sm" | "md";
};

export function TabColorBubbles({
  currentColor,
  onSelectColor,
  className,
  size = "sm",
}: TabColorBubblesProps) {
  const { t } = useTranslation();
  const dotSize = size === "sm" ? "size-2.5" : "size-3.5";

  return (
    <div
      data-no-drag
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        "flex items-center gap-1 rounded-full border border-border/40 bg-background/85 px-1.5 py-0.5 backdrop-blur-md shadow-xs transition-all",
        className,
      )}
    >
      {TAB_PALETTE.map((c) => {
        const isSelected = currentColor?.toLowerCase() === c.value.toLowerCase();
        const colorName = t(`projectToolkit.colorNames.${c.key}`);
        return (
          <button
            key={c.value}
            type="button"
            title={colorName}
            aria-label={t("projectToolkit.setColor", { name: colorName })}
            onClick={(e) => {
              e.stopPropagation();
              onSelectColor(isSelected ? null : c.value);
            }}
            className={cn(
              dotSize,
              "rounded-full transition-transform duration-150 hover:scale-125 focus:outline-none",
              isSelected
                ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-110"
                : "opacity-80 hover:opacity-100",
            )}
            style={{ backgroundColor: c.value }}
          />
        );
      })}
      {currentColor && (
        <button
          type="button"
          title={t("tooltips.clearColor")}
          aria-label={t("tooltips.clearTabTagColor")}
          onClick={(e) => {
            e.stopPropagation();
            onSelectColor(null);
          }}
          className={cn(
            dotSize,
            "flex items-center justify-center rounded-full border border-muted-foreground/30 text-[8px] text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          ✕
        </button>
      )}
    </div>
  );
}
