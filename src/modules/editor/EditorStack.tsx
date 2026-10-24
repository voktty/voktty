import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn, isMarkdownPath } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { MarkdownViewToggle } from "@/modules/markdown";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { EditorTab, Tab } from "@/modules/tabs";
import type { WorkspaceTextEditRequest } from "@/modules/workspace-edit";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EditorPaneHandle } from "./EditorPane";
import { PreviewEditorPane } from "@/modules/editor/components/PreviewEditorPane";
import type { PreviewOpeningAction } from "@/modules/preview/lib/previewOpeningTarget";
import { useEditorGroupPlacements } from "@/modules/editor/lib/useEditorGroupPlacements";
import {
  activateEditorInLayout,
  closeEditorGroup,
  createEditorGroupLayout,
  type EditorGroupDirection,
  type EditorGroupLayout,
  type EditorGroupNode,
  editorGroupLeaves,
  focusEditorGroup,
  retainEditorsInLayout,
  splitEditorGroup,
} from "./lib/editorGroupLayout";

export type EditorGroupHandle = {
  split: (direction: EditorGroupDirection) => void;
  closeActive: () => void;
  focusNext: (delta: 1 | -1) => void;
};

type Props = {
  tabs: Tab[];
  activeId: number;
  onDirtyChange: (id: number, dirty: boolean) => void;
  registerHandle: (id: number, handle: EditorPaneHandle | null) => void;
  registerGroupHandle?: (handle: EditorGroupHandle | null) => void;
  onActivateTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
  onOpenPreview?: PreviewOpeningAction;
  onWorkspaceEdit?: (request: WorkspaceTextEditRequest) => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

const MAX_EDITOR_GROUPS = 4;

export function EditorStack({
  tabs,
  activeId,
  onDirtyChange,
  registerHandle,
  registerGroupHandle,
  onActivateTab,
  onCloseTab,
  onSetMarkdownView,
  onOpenPreview,
  onWorkspaceEdit,
  canNavigateBack,
  canNavigateForward,
  onNavigateBack,
  onNavigateForward,
  placements,
}: Props) {
  const { t } = useTranslation();
  const editors = useMemo(
    () =>
      tabs.filter(
        (tab): tab is EditorTab => tab.kind === "editor" && !tab.cold,
      ),
    [tabs],
  );
  const editorById = useMemo(
    () => new Map(editors.map((editor) => [editor.id, editor])),
    [editors],
  );
  const activeTab = tabs.find((tab) => tab.id === activeId);
  const activeSpaceId = activeTab?.spaceId ?? null;
  const activeEditor = activeTab?.kind === "editor" ? activeTab : null;
  const nextGroupIdRef = useRef(1);
  const [layouts, setLayouts] = useState<Record<string, EditorGroupLayout>>({});

  const registerRef = useRef(registerHandle);
  const dirtyRef = useRef(onDirtyChange);
  const closeRef = useRef(onCloseTab);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    dirtyRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    closeRef.current = onCloseTab;
  }, [onCloseTab]);

  const refCallbacks = useRef(
    new Map<number, (handle: EditorPaneHandle | null) => void>(),
  );
  const dirtyCallbacks = useRef(new Map<number, (dirty: boolean) => void>());
  const closeCallbacks = useRef(new Map<number, () => void>());

  const getRefCallback = (id: number) => {
    let callback = refCallbacks.current.get(id);
    if (!callback) {
      callback = (handle) => registerRef.current(id, handle);
      refCallbacks.current.set(id, callback);
    }
    return callback;
  };
  const getDirtyCallback = (id: number) => {
    let callback = dirtyCallbacks.current.get(id);
    if (!callback) {
      callback = (dirty) => dirtyRef.current(id, dirty);
      dirtyCallbacks.current.set(id, callback);
    }
    return callback;
  };
  const getCloseCallback = (id: number) => {
    let callback = closeCallbacks.current.get(id);
    if (!callback) {
      callback = () => closeRef.current(id);
      closeCallbacks.current.set(id, callback);
    }
    return callback;
  };

  useEffect(() => {
    const live = new Set(editors.map((editor) => editor.id));
    for (const id of refCallbacks.current.keys()) {
      if (!live.has(id)) refCallbacks.current.delete(id);
    }
    for (const id of dirtyCallbacks.current.keys()) {
      if (!live.has(id)) dirtyCallbacks.current.delete(id);
    }
    for (const id of closeCallbacks.current.keys()) {
      if (!live.has(id)) closeCallbacks.current.delete(id);
    }
    setLayouts((current) => {
      let changed = false;
      const next: Record<string, EditorGroupLayout> = {};
      const liveBySpace = new Map<string, Set<number>>();
      for (const editor of editors) {
        const ids = liveBySpace.get(editor.spaceId) ?? new Set<number>();
        ids.add(editor.id);
        liveBySpace.set(editor.spaceId, ids);
      }
      for (const [spaceId, layout] of Object.entries(current)) {
        const retained = retainEditorsInLayout(
          layout,
          liveBySpace.get(spaceId) ?? new Set(),
        );
        next[spaceId] = retained;
        if (retained !== layout) changed = true;
      }
      return changed ? next : current;
    });
  }, [editors]);

  const activeEditorId = activeEditor?.id;
  const activeEditorSpaceId = activeEditor?.spaceId;
  useEffect(() => {
    if (activeEditorId === undefined || activeEditorSpaceId === undefined)
      return;
    setLayouts((current) => {
      const existing =
        current[activeEditorSpaceId] ??
        createEditorGroupLayout(nextGroupIdRef.current++);
      const next = activateEditorInLayout(existing, activeEditorId);
      return next === existing && current[activeEditorSpaceId]
        ? current
        : { ...current, [activeEditorSpaceId]: next };
    });
  }, [activeEditorId, activeEditorSpaceId]);

  const activeLayout = activeSpaceId ? layouts[activeSpaceId] : undefined;
  const groupPlacements = useEditorGroupPlacements(
    activeLayout?.tree,
    !placements &&
      activeEditorId !== undefined &&
      editorById.has(activeEditorId),
  );
  const groupByTab = useMemo(
    () =>
      new Map(
        (activeLayout ? editorGroupLeaves(activeLayout.tree) : []).flatMap(
          (leaf) =>
            leaf.tabId !== null &&
            editorById.get(leaf.tabId)?.spaceId === activeSpaceId
              ? [[leaf.tabId, leaf.groupId]]
              : [],
        ),
      ),
    [activeLayout, activeSpaceId, editorById],
  );

  const split = useCallback(
    (direction: EditorGroupDirection) => {
      if (!activeSpaceId) return;
      setLayouts((current) => {
        const existing =
          current[activeSpaceId] ??
          createEditorGroupLayout(nextGroupIdRef.current++);
        if (editorGroupLeaves(existing.tree).length >= MAX_EDITOR_GROUPS) {
          return current;
        }
        const next = splitEditorGroup(
          existing,
          direction,
          nextGroupIdRef.current++,
        );
        return { ...current, [activeSpaceId]: next };
      });
    },
    [activeSpaceId],
  );

  const closeActive = useCallback(() => {
    if (!activeSpaceId || !activeLayout) return;
    const next = closeEditorGroup(activeLayout, activeLayout.activeGroupId);
    if (next === activeLayout) return;
    setLayouts((current) => ({ ...current, [activeSpaceId]: next }));
    const nextTabId = editorGroupLeaves(next.tree).find(
      (leaf) => leaf.groupId === next.activeGroupId,
    )?.tabId;
    if (nextTabId !== null && nextTabId !== undefined) onActivateTab(nextTabId);
  }, [activeLayout, activeSpaceId, onActivateTab]);

  const focusNext = useCallback(
    (delta: 1 | -1) => {
      if (!activeSpaceId || !activeLayout) return;
      const leaves = editorGroupLeaves(activeLayout.tree);
      const currentIndex = leaves.findIndex(
        (leaf) => leaf.groupId === activeLayout.activeGroupId,
      );
      const nextIndex = (currentIndex + delta + leaves.length) % leaves.length;
      const target = leaves[nextIndex];
      const next = focusEditorGroup(activeLayout, target.groupId);
      setLayouts((current) => ({ ...current, [activeSpaceId]: next }));
      if (target.tabId !== null) onActivateTab(target.tabId);
    },
    [activeLayout, activeSpaceId, onActivateTab],
  );

  useEffect(() => {
    if (!registerGroupHandle) return;
    registerGroupHandle({ split, closeActive, focusNext });
    return () => registerGroupHandle(null);
  }, [closeActive, focusNext, registerGroupHandle, split]);

  const focusGroup = useCallback(
    (groupId: number, tabId: number | null) => {
      if (!activeSpaceId) return;
      setLayouts((current) => {
        const layout = current[activeSpaceId];
        if (!layout) return current;
        const next = focusEditorGroup(layout, groupId);
        return next === layout
          ? current
          : { ...current, [activeSpaceId]: next };
      });
      if (tabId !== null) onActivateTab(tabId);
    },
    [activeSpaceId, onActivateTab],
  );

  const renderEditor = (tab: EditorTab, visible: boolean) => (
    <div className="relative h-full overflow-hidden bg-background">
      {isMarkdownPath(tab.path) && (
        <MarkdownViewToggle
          mode="raw"
          onChange={(mode) => onSetMarkdownView(tab.id, mode)}
          renderedDisabled={tab.dirty}
          renderedHint={t("commandPalette.commands.editorSaveToPreview")}
        />
      )}
      <PreviewEditorPane
        tab={tab}
        visible={visible}
        ref={getRefCallback(tab.id)}
        editorId={tab.id}
        spaceId={tab.spaceId}
        path={tab.path}
        workspaceEnv={tab.workspaceEnv ?? LOCAL_WORKSPACE}
        overrideLanguage={tab.overrideLanguage}
        onDirtyChange={getDirtyCallback(tab.id)}
        onClose={getCloseCallback(tab.id)}
        onOpenPreview={onOpenPreview}
        onWorkspaceEdit={onWorkspaceEdit}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        onNavigateBack={onNavigateBack}
        onNavigateForward={onNavigateForward}
      />
    </div>
  );

  const renderGroupNode = (node: EditorGroupNode): React.ReactNode => {
    if (node.kind === "leaf") {
      const tab =
        node.tabId === null ? null : (editorById.get(node.tabId) ?? null);
      const focused = activeLayout?.activeGroupId === node.groupId;
      return (
        <div
          ref={(element) => {
            if (element)
              groupPlacements.groupRefs.current.set(node.groupId, element);
            else groupPlacements.groupRefs.current.delete(node.groupId);
          }}
          data-editor-group={node.groupId}
          className={cn(
            "relative h-full min-h-0 overflow-hidden bg-background",
            focused && "ring-1 ring-inset ring-primary/35",
          )}
          onMouseDownCapture={() => focusGroup(node.groupId, node.tabId)}
          onFocusCapture={() => focusGroup(node.groupId, node.tabId)}
        >
          {!tab ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              {t("commandPalette.commands.editorEmptyGroup")}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <ResizablePanelGroup
        orientation={node.direction === "row" ? "horizontal" : "vertical"}
      >
        {node.children.map((child, index) => {
          const groupId = editorGroupLeaves(child)[0]?.groupId ?? index;
          return (
            <Fragment key={groupId}>
              {index > 0 && <ResizableHandle />}
              <ResizablePanel id={`editor-group-${groupId}`} minSize="15%">
                {renderGroupNode(child)}
              </ResizablePanel>
            </Fragment>
          );
        })}
      </ResizablePanelGroup>
    );
  };

  if (editors.length === 0) return null;

  return (
    <div ref={groupPlacements.rootRef} className="relative h-full w-full">
      <div key="editor-groups" className="absolute inset-0">
        {!placements && activeLayout
          ? renderGroupNode(activeLayout.tree)
          : null}
      </div>
      {editors.map((editor) => {
        const placement = placements?.get(editor.id);
        const groupId = groupByTab.get(editor.id);
        const rect = placements
          ? placement?.rect
          : groupId === undefined
            ? !activeLayout && activeEditorId === editor.id
              ? { x: 0, y: 0, width: 1, height: 1 }
              : undefined
            : groupPlacements.rects.get(groupId);
        const focused =
          !placements &&
          groupId !== undefined &&
          activeLayout?.activeGroupId === groupId;
        return (
          <div
            key={editor.id}
            data-space-slot={placement?.slotId}
            data-space-tab={editor.id}
            data-editor-group-owner={placements ? undefined : groupId}
            className={cn(
              "absolute bg-background",
              focused && "ring-1 ring-inset ring-primary/35",
            )}
            style={{
              ...(rect
                ? {
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                  }
                : { inset: 0, visibility: "hidden" }),
              pointerEvents: rect ? "auto" : "none",
              contain: "strict",
              isolation: "isolate",
            }}
            aria-hidden={!rect}
            onMouseDownCapture={() => {
              if (!placements && groupId !== undefined)
                focusGroup(groupId, editor.id);
            }}
            onFocusCapture={() => {
              if (!placements && groupId !== undefined)
                focusGroup(groupId, editor.id);
            }}
          >
            {renderEditor(editor, Boolean(rect))}
          </div>
        );
      })}
    </div>
  );
}
