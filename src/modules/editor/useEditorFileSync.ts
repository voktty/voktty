import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import type { Tab } from "@/modules/tabs";
import { isRemoteProjectUri } from "@/modules/explorer/lib/remoteProjectDir";
import {
  type WorkspaceEnv,
  LOCAL_WORKSPACE,
  workspaceForDocumentPath,
  workspaceScopeKey,
  isWindowsNativePath,
} from "@/modules/workspace";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  parseFileWritten,
  fileWrittenMatches,
} from "@/modules/workspace/fileWritten";
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
): Map<string, EditorWatchGroup> {
  const groups = new Map<string, EditorWatchGroup>();
  for (const tab of tabs) {
    if (tab.kind !== "editor" || isRemoteProjectUri(tab.path)) continue;
    const workspace = workspaceForDocumentPath(
      tab.workspaceEnv ?? LOCAL_WORKSPACE,
      tab.path,
    );
    const key = editorWorkspaceKey(workspace);
    const group = groups.get(key) ?? {
      key,
      paths: new Set<string>(),
      workspace,
    };
    const separator = tab.path.lastIndexOf("/");
    group.paths.add(
      isWindowsNativePath(tab.path)
        ? parentDir(tab.path)
        : separator < 0
          ? tab.path
          : tab.path.slice(0, Math.max(1, separator)),
    );
    groups.set(key, group);
  }
  return groups;
}

/**
 * Keeps open editor tabs in sync with on-disk changes: reloads on applied AI
 * diffs, external writes, and fs-watch events, and maintains the watch set for
 * the directories of open editor files.
 */
export function useEditorFileSync({ tabs, tabsRef, editorRefs }: Params) {
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
    let active = true;
    const unlistenPromise = getCurrentWebviewWindow()
      .listen<unknown>("fs:file-written", (event) => {
        if (!active) return;
        const written = parseFileWritten(event.payload);
        if (!written || written.source === "editor") return;
        const currentTabs = tabsRef.current;
        for (const t of currentTabs) {
          if (t.kind !== "editor") continue;
          if (
            fileWrittenMatches(
              written,
              t.path,
              t.workspaceEnv ?? LOCAL_WORKSPACE,
            )
          ) {
            const handle = editorRefs.current.get(t.id);
            handle?.notifyExternalChange();
            if (
              active &&
              tabsRef.current.includes(t) &&
              editorRefs.current.get(t.id) === handle
            )
              handle?.reload(false);
          }
        }
      })
      .catch(() => () => {});
    return () => {
      active = false;
      void unlistenPromise.then((un) => un()).catch(() => {});
    };
  }, [tabsRef, editorRefs]);

  const editorWatchRef = useRef<Map<string, EditorWatchGroup>>(new Map());
  useEffect(() => {
    const next = collectEditorWatchGroups(tabs);
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
  }, [tabs]);

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
    const groups = collectEditorWatchGroups(tabs);
    for (const group of groups.values()) {
      void listenFsChanged((paths) => {
        if (!alive) return;
        const changed = new Set(paths.map(editorWatchPath));
        for (const tab of tabsRef.current) {
          if (!alive) return;
          if (
            tab.kind !== "editor" ||
            isRemoteProjectUri(tab.path) ||
            !tabsRef.current.includes(tab)
          )
            continue;
          const tabWorkspace = workspaceForDocumentPath(
            tab.workspaceEnv ?? LOCAL_WORKSPACE,
            tab.path,
          );
          if (editorWorkspaceKey(tabWorkspace) !== group.key) continue;
          if (changed.has(editorWatchPath(tab.path))) {
            const handle = editorRefs.current.get(tab.id);
            handle?.notifyExternalChange();
            if (
              alive &&
              tabsRef.current.includes(tab) &&
              editorRefs.current.get(tab.id) === handle
            )
              handle?.reload(false);
          }
        }
      }, group.workspace)
        .then((unlisten) => {
          if (alive) unlisteners.push(unlisten);
          else unlisten();
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [tabs, tabsRef, editorRefs]);
}

function editorWatchPath(path: string): string {
  return isWindowsNativePath(path)
    ? path.replace(/\\/g, "/").toLowerCase()
    : path;
}
