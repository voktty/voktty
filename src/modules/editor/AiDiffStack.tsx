import type { WorkspacePlacement } from "@/modules/spaces";
import type { AiDiffTab, Tab } from "@/modules/tabs";
import { AiDiffPane } from "./AiDiffPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onAccept: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function AiDiffStack({
  tabs,
  activeId,
  onAccept,
  onReject,
  placements,
}: Props) {
  const diffs = tabs.filter(
    (tab): tab is AiDiffTab => tab.kind === "ai-diff" && !tab.cold,
  );
  if (diffs.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {diffs.map((tab) => {
        const placement = placements?.get(tab.id);
        const visible = placements
          ? placement !== undefined
          : tab.id === activeId;
        return (
          <div
            key={tab.id}
            data-space-slot={placement?.slotId}
            data-space-tab={tab.id}
            className="absolute"
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
            <div
              className={
                visible
                  ? "h-full w-full"
                  : "invisible pointer-events-none h-full w-full"
              }
            >
              <AiDiffPane
                path={tab.path}
                originalContent={tab.originalContent}
                proposedContent={tab.proposedContent}
                status={tab.status}
                isNewFile={tab.isNewFile}
                onAccept={() => onAccept(tab.approvalId)}
                onReject={() => onReject(tab.approvalId)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
