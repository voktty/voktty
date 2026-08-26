import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import type { Tab } from "@/modules/tabs";
import {
  type WorkspaceEnv,
  workspaceForDocumentPath,
  workspaceScopeKey,
} from "@/modules/workspace";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type RefObject, useEffect, useRef } from "react";
import type { EditorPaneHandle } from "./EditorPane";

type Params = {
  tabs: Tab[];
  tabsRef: RefObject<Tab[]>;
  editorRefs: RefObject<Map<number, EditorPaneHandle>>;
  workspace: WorkspaceEnv;
};

type EditorWatchGroup = {
  key: string;
  paths: Set<string>;
  workspace: WorkspaceEnv;
};

function editorWorkspaceKey(workspace: WorkspaceEnv): string {
  return `${workspaceScopeKey(workspace)}:${
    workspace.kind === "ssh" ? (workspace.sessionId ?? "offline") : "ready"
  }`;
}

export function collectEditorWatchGroups(
  tabs: Tab[],
  fallbackWorkspace: WorkspaceEnv,
): Map<string, EditorWatchGroup> {
  const groups = new Map<string, EditorWatchGroup>();
  for (const tab of tabs) {
    if (tab.kind !== "editor") continue;
    const workspace = workspaceForDocumentPath(
      tab.workspaceEnv ?? fallbackWorkspace,
      tab.path,
    );
    const key = editorWorkspaceKey(workspace);
    const group = groups.get(key) ?? {
      key,
      paths: new Set<string>(),
      workspace,
    };
    group.paths.add(parentDir(tab.path));
    groups.set(key, group);
  }
  return groups;
}

/**
 * Keeps open editor tabs in sync with on-disk changes: reloads on applied AI
 * diffs, external writes, and fs-watch events, and maintains the watch set for
 * the directories of open editor files.
 */
export function useEditorFileSync({
  tabs,
  tabsRef,
  editorRefs,
  workspace,
}: Params) {
  // When an AI diff is approved (write_file applied to disk), reload any
  // open editor tabs for that path so the user sees the new content. We
  // track which approvalIds we've already handled to fire the reload only
  // once per applied diff.
  const appliedDiffsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind !== "ai-diff") continue;
      if (t.status !== "approved") continue;
      if (appliedDiffsRef.current.has(t.approvalId)) continue;
      appliedDiffsRef.current.add(t.approvalId);
      for (const e of tabs) {
        if (e.kind !== "editor") continue;
        if (e.path !== t.path) continue;
        editorRefs.current.get(e.id)?.reload();
      }
    }
  }, [tabs, editorRefs]);

  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source === "editor") return;
          const normalizedPath = event.payload.path.replace(/\\/g, "/");
          const currentTabs = tabsRef.current;
          for (const t of currentTabs) {
            if (t.kind !== "editor") continue;
            if (t.path.replace(/\\/g, "/") === normalizedPath) {
              const handle = editorRefs.current.get(t.id);
              handle?.notifyExternalChange();
              handle?.reload(false);
            }
          }
        },
      );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, [tabsRef, editorRefs]);

  const editorWatchRef = useRef<Map<string, EditorWatchGroup>>(new Map());
  useEffect(() => {
    const next = collectEditorWatchGroups(tabs, workspace);
    const previous = editorWatchRef.current;

    for (const [key, prior] of previous) {
      const wanted = next.get(key);
      const toRemove = [...prior.paths].filter(
        (directory) => !wanted?.paths.has(directory),
      );
      watchRemove(toRemove, prior.workspace);
    }
    for (const [key, wanted] of next) {
      const prior = previous.get(key);
      const toAdd = [...wanted.paths].filter(
        (directory) => !prior?.paths.has(directory),
      );
      watchAdd(toAdd, wanted.workspace);
    }
    editorWatchRef.current = next;
  }, [tabs, workspace]);

  useEffect(
    () => () => {
      for (const watched of editorWatchRef.current.values()) {
        watchRemove([...watched.paths], watched.workspace);
        watched.paths.clear();
      }
      editorWatchRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    const groups = collectEditorWatchGroups(tabs, workspace);
    for (const group of groups.values()) {
      void listenFsChanged(
        (paths) => {
          const changed = new Set(paths.map((p) => p.replace(/\\/g, "/")));
          for (const tab of tabsRef.current) {
            if (tab.kind !== "editor") continue;
            const tabWorkspace = workspaceForDocumentPath(
              tab.workspaceEnv ?? workspace,
              tab.path,
            );
            if (editorWorkspaceKey(tabWorkspace) !== group.key) continue;
            if (changed.has(tab.path.replace(/\\/g, "/"))) {
              const handle = editorRefs.current.get(tab.id);
              handle?.notifyExternalChange();
              handle?.reload(false);
            }
          }
        },
        group.workspace,
      ).then((unlisten) => {
        if (alive) unlisteners.push(unlisten);
        else unlisten();
      });
    }
    return () => {
      alive = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [tabs, tabsRef, editorRefs, workspace]);
}
