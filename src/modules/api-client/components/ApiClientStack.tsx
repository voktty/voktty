import { cn } from "@/lib/utils";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { ApiClientTab, Tab } from "@/modules/tabs";
import { ApiClientView } from "./ApiClientView";

type Props = {
  tabs: Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function ApiClientStack({ tabs, activeId, placements }: Props) {
  const apiTabs = tabs.filter(
    (t): t is ApiClientTab => t.kind === "api-client" && !t.cold,
  );

  if (apiTabs.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      {apiTabs.map((tab) => {
        const placement = placements?.get(tab.id);
        const visible = placements
          ? placement !== undefined
          : tab.id === activeId;

        return (
          <div
            key={tab.id}
            data-space-slot={placement?.slotId}
            data-space-tab={tab.id}
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
            <ApiClientView />
          </div>
        );
      })}
    </div>
  );
}
