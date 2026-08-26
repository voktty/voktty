import { cn } from "@/lib/utils";
import { AiDiffStack, EditorStack, GitDiffStack } from "@/modules/editor";
import { GitHistoryStack } from "@/modules/git-history";
import { MarkdownStack } from "@/modules/markdown";
import { PreviewStack } from "@/modules/preview";
import { RdpStack } from "@/modules/rdp";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { Tab } from "@/modules/tabs";
import { TerminalStack } from "@/modules/terminal";
import type { ComponentProps } from "react";

type TerminalStackProps = ComponentProps<typeof TerminalStack>;
type EditorStackProps = ComponentProps<typeof EditorStack>;
type PreviewStackProps = ComponentProps<typeof PreviewStack>;
type AiDiffStackProps = ComponentProps<typeof AiDiffStack>;
type GitHistoryStackProps = ComponentProps<typeof GitHistoryStack>;
type GitDiffStackProps = ComponentProps<typeof GitDiffStack>;

export type WorkspaceSurfaceProps = {
  tabs: Tab[];
  activeId: number;
  activeTab: Tab | undefined;
  registerTerminalHandle: TerminalStackProps["registerHandle"];
  onSearchReady: TerminalStackProps["onSearchReady"];
  onCwd: TerminalStackProps["onCwd"];
  onExit: TerminalStackProps["onExit"];
  onFocusLeaf: TerminalStackProps["onFocusLeaf"];
  registerEditorHandle: EditorStackProps["registerHandle"];
  registerEditorGroupHandle: EditorStackProps["registerGroupHandle"];
  onActivateEditorTab: EditorStackProps["onActivateTab"];
  onEditorDirtyChange: EditorStackProps["onDirtyChange"];
  onEditorCloseTab: EditorStackProps["onCloseTab"];
  registerPreviewHandle: PreviewStackProps["registerHandle"];
  onPreviewUrlChange: PreviewStackProps["onUrlChange"];
  onAiDiffAccept: AiDiffStackProps["onAccept"];
  onAiDiffReject: AiDiffStackProps["onReject"];
  onOpenCommitFile: GitHistoryStackProps["onOpenCommitFile"];
  onGitHistorySearchHandle: GitHistoryStackProps["onSearchHandle"];
  onSetMarkdownView: EditorStackProps["onSetMarkdownView"];
  registerMarkdownHandle?: (
    id: number,
    handle: import("@/modules/markdown").MarkdownSearchHandle | null,
  ) => void;
  onOpenPreview?: (url: string) => void;
  onWorkspaceEdit: EditorStackProps["onWorkspaceEdit"];
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  gitReview?: GitDiffStackProps["review"];
  placements?: readonly WorkspacePlacement[];
};

const LAYER = "absolute inset-0";

/**
 * Stacks every tab-kind surface absolutely on top of each other and toggles
 * visibility off the active tab, so panes keep their mounted state (terminal
 * buffers, editor scroll, ...) when switching tabs.
 *
 * Layers sit flush inside the workspace pane; only the terminal layer is inset,
 * because xterm draws glyphs right up to its container edge.
 */
export function WorkspaceSurface({
  tabs,
  activeId,
  activeTab,
  registerTerminalHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
  registerEditorHandle,
  registerEditorGroupHandle,
  onActivateEditorTab,
  onEditorDirtyChange,
  onEditorCloseTab,
  registerPreviewHandle,
  onPreviewUrlChange,
  onAiDiffAccept,
  onAiDiffReject,
  onOpenCommitFile,
  onGitHistorySearchHandle,
  onSetMarkdownView,
  registerMarkdownHandle,
  onOpenPreview,
  onWorkspaceEdit,
  canNavigateBack,
  canNavigateForward,
  onNavigateBack,
  onNavigateForward,
  gitReview,
  placements,
}: WorkspaceSurfaceProps) {
  const kind = activeTab?.kind;
  const placementByTabId = new Map(
    (placements ?? []).map((placement) => [placement.tabId, placement]),
  );
  const visualLayout = placements !== undefined;
  const layerVisible = (tabKinds: Tab["kind"] | Tab["kind"][]) => {
    const kinds = new Set(Array.isArray(tabKinds) ? tabKinds : [tabKinds]);
    return visualLayout
      ? tabs.some(
          (tab) =>
            kinds.has(tab.kind) && placementByTabId.has(tab.id) && !tab.cold,
        )
      : kinds.has(kind as Tab["kind"]);
  };

  return (
    <div className="relative h-full min-h-0">
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible("terminal") && "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible("terminal")}
      >
        <TerminalStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerTerminalHandle}
          onSearchReady={onSearchReady}
          onCwd={onCwd}
          onExit={onExit}
          onFocusLeaf={onFocusLeaf}
          placements={placements ? placementByTabId : undefined}
        />
      </div>
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible("editor") && "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible("editor")}
      >
        <EditorStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerEditorHandle}
          registerGroupHandle={registerEditorGroupHandle}
          onActivateTab={onActivateEditorTab}
          onDirtyChange={onEditorDirtyChange}
          onCloseTab={onEditorCloseTab}
          onSetMarkdownView={onSetMarkdownView}
          onOpenPreview={onOpenPreview}
          onWorkspaceEdit={onWorkspaceEdit}
          canNavigateBack={canNavigateBack}
          canNavigateForward={canNavigateForward}
          onNavigateBack={onNavigateBack}
          onNavigateForward={onNavigateForward}
          placements={placements ? placementByTabId : undefined}
        />
      </div>
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible("preview") && "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible("preview")}
      >
        <PreviewStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerPreviewHandle}
          onUrlChange={onPreviewUrlChange}
          placements={placements ? placementByTabId : undefined}
        />
      </div>
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible("markdown") && "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible("markdown")}
      >
        <MarkdownStack
          tabs={tabs}
          activeId={activeId}
          onSetMarkdownView={onSetMarkdownView}
          registerHandle={registerMarkdownHandle}
          placements={placements ? placementByTabId : undefined}
        />
      </div>
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible("ai-diff") && "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible("ai-diff")}
      >
        <AiDiffStack
          tabs={tabs}
          activeId={activeId}
          onAccept={onAiDiffAccept}
          onReject={onAiDiffReject}
          placements={placements ? placementByTabId : undefined}
        />
      </div>
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible(["git-diff", "git-commit-file"]) &&
            "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible(["git-diff", "git-commit-file"])}
      >
        <GitDiffStack
          tabs={tabs}
          activeId={activeId}
          placements={placements ? placementByTabId : undefined}
          review={gitReview}
        />
      </div>
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible("git-history") && "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible("git-history")}
      >
        <GitHistoryStack
          tabs={tabs}
          activeId={activeId}
          onOpenCommitFile={onOpenCommitFile}
          onSearchHandle={onGitHistorySearchHandle}
          placements={placements ? placementByTabId : undefined}
        />
      </div>
      <div
        className={cn(
          LAYER,
          visualLayout && "pointer-events-none",
          !layerVisible("rdp") && "invisible pointer-events-none",
        )}
        aria-hidden={!layerVisible("rdp")}
      >
        <RdpStack
          tabs={tabs}
          activeId={activeId}
          placements={placements ? placementByTabId : undefined}
        />
      </div>
    </div>
  );
}
