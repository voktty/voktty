import { cn } from "@/lib/utils";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { RdpTab, Tab } from "@/modules/tabs";
import { RdpPane } from "./components/RdpPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

const LAYER = "absolute inset-0";

export function RdpStack({ tabs, activeId, placements }: Props) {
  const rdpTabs = tabs.filter((t): t is RdpTab => t.kind === "rdp" && !t.cold);

  if (rdpTabs.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      {rdpTabs.map((tab) => {
        const placement = placements?.get(tab.id);
        const isActive = placements
          ? placement !== undefined
          : tab.id === activeId;
        return (
          <div
            key={tab.id}
            data-space-slot={placement?.slotId}
            data-space-tab={tab.id}
            className={cn(
              placements ? "absolute" : LAYER,
              !isActive && "invisible pointer-events-none",
            )}
            style={
              placement
                ? {
                    left: `${placement.rect.x * 100}%`,
                    top: `${placement.rect.y * 100}%`,
                    width: `${placement.rect.width * 100}%`,
                    height: `${placement.rect.height * 100}%`,
                  }
                : undefined
            }
            aria-hidden={!isActive}
          >
            <RdpPane
              host={tab.host}
              port={tab.port}
              username={tab.username}
              domain={tab.domain}
              autoConnect={tab.autoConnect ?? true}
            />
          </div>
        );
      })}
    </div>
  );
}
