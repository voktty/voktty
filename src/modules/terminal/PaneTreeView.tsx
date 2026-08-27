import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SearchAddon } from "@xterm/addon-search";
import { Fragment, memo } from "react";
import { useTerminalDropStore } from "./lib/dropStore";
import { firstLeafSlotId, type PaneNode } from "./lib/panes";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onTitle: (leafId: number, title: string) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number | null;
  blocks: boolean;
  workspaceEnv: WorkspaceEnv;
  shellOverride?: string;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
};

export const PaneTreeView = memo(function PaneTreeView(props: Props) {
  const { node } = props;
  const { t } = useTranslation();
  if (node.kind === "leaf") {
    const {
      tabVisible,
      activeLeafId,
      blocks,
      workspaceEnv,
      shellOverride,
      onFocusLeaf,
      getBundle,
    } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    return (
      <section
        onMouseDownCapture={() => {
          onFocusLeaf(node.id);
        }}
        // Catches focus from Tab, programmatic focus, or any path that
        // skips mousedown — keeps activeLeafId in sync with DOM focus.
        onFocus={() => {
          onFocusLeaf(node.id);
        }}
        onMouseEnter={() => useAgentStore.getState().clearPulse(node.id)}
        onMouseMove={() => {
          if (useAgentStore.getState().pulsingLeaves[node.id]) {
            useAgentStore.getState().clearPulse(node.id);
          }
        }}
        data-pane-leaf={node.id}
        aria-label={t("spaces.slot", { id: node.slotId ?? node.id })}
        data-pane-focused={focused ? "true" : "false"}
        className="relative h-full w-full overflow-hidden"
        style={{ contain: "strict", isolation: "isolate" }}
      >
        <TerminalPane
          leafId={node.id}
          visible={tabVisible}
          focused={focused}
          initialCwd={node.cwd}
          workspaceEnv={workspaceEnv}
          shellOverride={shellOverride}
          blocks={blocks}
          ref={b.setRef}
          onSearchReady={b.onSearchReady}
          onCwd={b.onCwd}
          onExit={b.onExit}
          onTitle={b.onTitle}
        />
        <DropOverlay leafId={node.id} />
        <FinishedPulse leafId={node.id} />
      </section>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => {
        const slotId = firstLeafSlotId(child);
        return (
          <Fragment key={slotId}>
            {i > 0 && (
              <ResizableHandle className="bg-border/50 transition-colors duration-[var(--dur-fast)] after:w-3 hover:bg-border" />
            )}
            <ResizablePanel id={`pane-slot-${slotId}`} minSize="10%">
              <PaneTreeView {...props} node={child} />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
});

function DropOverlay({ leafId }: { leafId: number }) {
  const { t } = useTranslation();
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      {t("explorer.dropFilePath")}
    </div>
  );
}

/** CLI finished slow pulse border for the finished leaf; clears on hover/move. */
function FinishedPulse({ leafId }: { leafId: number }) {
  const pulsing = useAgentStore((s) => !!s.pulsingLeaves[leafId]);
  if (!pulsing) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 rounded-sm voktty-finished-pulse"
    />
  );
}
