import { cn } from "@/lib/utils";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { MarkdownTab, Tab } from "@/modules/tabs";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import { MarkdownPreviewPane, type MarkdownSearchHandle } from "./MarkdownPreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
  registerHandle?: (id: number, handle: MarkdownSearchHandle | null) => void;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function MarkdownStack({
  tabs,
  activeId,
  onSetMarkdownView,
  registerHandle,
  placements,
}: Props) {
  const markdowns = tabs.filter(
    (t): t is MarkdownTab => t.kind === "markdown" && !t.cold,
  );
  if (markdowns.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {markdowns.map((t) => {
        const placement = placements?.get(t.id);
        const visible = placements
          ? placement !== undefined
          : t.id === activeId;
        return (
          <div
            key={t.id}
            data-space-slot={placement?.slotId}
            data-space-tab={t.id}
            className={cn(
              "absolute",
              !visible && "invisible pointer-events-none",
            )}
            style={
              placement
                ? {
                    left: `${placement.rect.x * 100}%`,
                    top: `${placement.rect.y * 100}%`,
                    width: `${placement.rect.width * 100}%`,
                    height: `${placement.rect.height * 100}%`,
                    pointerEvents: "auto",
                  }
                : { inset: 0, pointerEvents: visible ? "auto" : "none" }
            }
            aria-hidden={!visible}
          >
            <MarkdownPreviewPane
              ref={(h) => registerHandle?.(t.id, h)}
              path={t.path}
              workspaceEnv={t.workspaceEnv ?? LOCAL_WORKSPACE}
              visible={visible}
              onSetView={(mode) => onSetMarkdownView(t.id, mode)}
            />
          </div>
        );
      })}
    </div>
  );
}
