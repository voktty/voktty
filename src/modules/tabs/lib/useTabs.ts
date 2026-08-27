import { isMarkdownPath } from "@/lib/utils";
import { t as translate } from "@/modules/i18n";
import {
  type AgentInstanceCount,
  createAgentPanePlan,
} from "@/modules/agents/lib/launcher";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  nextLeafId,
  type PaneBounds,
  type PaneDirection,
  type PaneNode,
  removeLeaf,
  type SplitDir,
  setLeafCwd as setLeafCwdInTree,
  siblingLeafOf,
  splitLeaf,
  swapLeafInDirection,
} from "@/modules/terminal/lib/panes";
import { disposeSession } from "@/modules/terminal/lib/useTerminalSession";
import { registerGuestTerminal } from "@/modules/collab/lib/guestRuntime";
import type { GuestTerminalCredentials } from "@/modules/collab/types";
import { MAX_PANES_PER_TAB } from "@/modules/terminal/lib/paneLimits";
import {
  currentWorkspaceEnv,
  documentWorkspaceKey,
  type DockerWorkspaceConnection,
  LOCAL_WORKSPACE,
  type SerialConnectionConfig,
  type WorkspaceEnv,
  workspaceForDocumentPath,
} from "@/modules/workspace";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  pushClosedEditor,
  takeClosedEditor,
  type ClosedEditor,
} from "./recentlyClosedEditors";
import {
  createTabIdentity,
  workspaceScopeIdFromLegacySpace,
  type TabKey,
  type WorkspaceScopeId,
} from "./tabIdentity";

export { MAX_PANES_PER_TAB } from "@/modules/terminal/lib/paneLimits";

type TabBase = {
  spaceId: string;
  tabKey: TabKey;
  workspaceScopeId: WorkspaceScopeId;
  /** Restored from disk, not yet activated: rendered as a placeholder, not mounted. */
  cold?: boolean;
  /** Classification color / visual tag. */
  color?: string | null;
  /** If locked, tab cannot be closed until unlocked. */
  locked?: boolean;
  /** Timestamp in ms when tab was opened. */
  createdAt?: number;
};

export type TerminalTab = TabBase & {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
  blocks?: boolean;
  /** AI agent cannot read buffer / context of this terminal. */
  private?: boolean;
  /** User-set label that overrides the cwd-derived name. Survives cd. */
  customTitle?: string;
  /** Environment used when this terminal session is created. */
  workspaceEnv?: WorkspaceEnv;
  /** Custom shell executable path override (e.g. pwsh.exe, cmd.exe, git bash, zsh). */
  shellOverride?: string;
  /** Ephemeral collaboration metadata. Credentials live only in memory. */
  collaboration?: { mode: "guest" };
};

export type EditorTab = TabBase & {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
  /**
   * True while the tab is in the transient "preview" state — opened by a
   * single-click in the explorer and not yet pinned by the user. A preview tab
   * is replaced by the next single-click rather than accumulating.
   */
  preview: boolean;
  overrideLanguage?: string | null;
  /** Filesystem captured when the document was opened. */
  workspaceEnv?: WorkspaceEnv;
};

export type PreviewTab = TabBase & {
  id: number;
  kind: "preview";
  title: string;
  url: string;
  /** Stable workspace/server link used by terminal dev-server capture. */
  devServerScope?: string;
};

export type MarkdownTab = TabBase & {
  id: number;
  kind: "markdown";
  title: string;
  path: string;
  /** Filesystem captured when the document was opened. */
  workspaceEnv?: WorkspaceEnv;
};

export type AiDiffStatus = "pending" | "approved" | "rejected";

export type AiDiffTab = TabBase & {
  id: number;
  kind: "ai-diff";
  title: string;
  path: string;
  /** "" for newly created files. */
  originalContent: string;
  proposedContent: string;
  /** Tool-call approval id used to resolve the AI SDK approval. */
  approvalId: string;
  status: AiDiffStatus;
  isNewFile: boolean;
};

export type GitDiffTab = TabBase & {
  id: number;
  kind: "git-diff";
  title: string;
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath: string | null;
  preview: boolean;
  workspaceEnv?: WorkspaceEnv;
};

export type GitHistoryTab = TabBase & {
  id: number;
  kind: "git-history";
  title: string;
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
};

export type GitCommitFileDiffTab = TabBase & {
  id: number;
  kind: "git-commit-file";
  title: string;
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
  workspaceEnv?: WorkspaceEnv;
};

export type RdpTab = TabBase & {
  id: number;
  kind: "rdp";
  title: string;
  host: string;
  port?: number;
  username?: string;
  domain?: string;
  autoConnect?: boolean;
};

export type ApiClientTab = TabBase & {
  id: number;
  kind: "api-client";
  title: string;
};

export type Tab =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | AiDiffTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab
  | RdpTab
  | ApiClientTab;

export type TabPatch = Partial<{
  title: string;
  cwd: string;
  path: string;
  dirty: boolean;
  url: string;
  devServerScope: string;
  /** Empty string resets a terminal tab to its cwd-derived name. */
  customTitle: string;
  overrideLanguage: string | null;
  workspaceEnv: WorkspaceEnv;
  color: string | null;
  locked: boolean;
}>;

export type GitDiffOpenInput = {
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath?: string | null;
  title?: string;
  workspaceEnv?: WorkspaceEnv;
};

export type OpenFileTabOptions = {
  spaceId?: string;
  activate?: boolean;
  workspaceEnv?: WorkspaceEnv;
};

export type CloseTabsPlan = {
  closeIds: number[];
  nextActiveId: number;
};

type CloseTabsPlanResult = {
  tabs: Tab[];
  closeIds: number[];
  disposeLeafIds: number[];
  nextActiveId: number;
};

export function planMarkdownTabOpen(
  tabs: Tab[],
  path: string,
  spaceId: string,
  allocId: () => number,
  workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
): { tabs: Tab[]; tabId: number } {
  const documentEnv = workspaceForDocumentPath(workspaceEnv, path);
  const pathKey = documentWorkspaceKey(documentEnv, path);
  const existing = tabs.find(
    (tab) =>
      tab.kind === "markdown" &&
      tab.spaceId === spaceId &&
      documentWorkspaceKey(tab.workspaceEnv, tab.path) === pathKey,
  );
  if (existing) return { tabs, tabId: existing.id };

  const tabId = allocId();
  return {
    tabs: [
      ...tabs,
      {
        id: tabId,
        ...createTabIdentity(spaceId),
        kind: "markdown",
        spaceId,
        title: basename(path),
        path,
        workspaceEnv: documentEnv,
      },
    ],
    tabId,
  };
}

export function planFileTabOpen(
  tabs: Tab[],
  path: string,
  pin: boolean,
  spaceId: string,
  allocId: () => number,
  workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
): { tabs: Tab[]; tabId: number } {
  const documentEnv = workspaceForDocumentPath(workspaceEnv, path);
  const pathKey = documentWorkspaceKey(documentEnv, path);
  const existing = tabs.find(
    (tab) =>
      tab.kind === "editor" &&
      tab.spaceId === spaceId &&
      documentWorkspaceKey(tab.workspaceEnv, tab.path) === pathKey,
  );
  if (existing?.kind === "editor") {
    return {
      tabs:
        pin && existing.preview
          ? tabs.map((tab) =>
              tab.id === existing.id ? { ...tab, preview: false } : tab,
            )
          : tabs,
      tabId: existing.id,
    };
  }

  const tabId = allocId();
  return {
    tabs: [
      ...tabs,
      {
        id: tabId,
        ...createTabIdentity(spaceId),
        kind: "editor",
        spaceId,
        title: basename(path),
        path,
        dirty: false,
        preview: false,
        workspaceEnv: documentEnv,
      },
    ],
    tabId,
  };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url || "preview";
  }
}

export const DEFAULT_SPACE_ID = "default";
export const NO_ACTIVE_TAB_ID = -1;

// Returns the tab at position `idx` within the given space, or undefined when
// idx is out of range or no matching space tab exists.
export function pickTabBySpaceIndex(
  tabs: Tab[],
  idx: number,
  spaceId: string,
): Tab | undefined {
  const pool = tabs.filter((t) => t.spaceId === spaceId);
  return pool[idx];
}

// Local fallback after close, scoped to the closing tab's workspace. A null
// result delegates the global visual fallback to planTabCloseFocus.
export function nextActiveInSpace(
  tabs: Tab[],
  closingId: number,
): number | null {
  const closing = tabs.find((t) => t.id === closingId);
  if (!closing) return null;
  const sameSpace = tabs.filter((t) => t.spaceId === closing.spaceId);
  if (sameSpace.length <= 1) return null;
  const idx = sameSpace.findIndex((t) => t.id === closingId);
  return (sameSpace[idx - 1] ?? sameSpace[idx + 1]).id;
}

// Gap index is relative to the space's own strip, including the dragged tab.
export function reorderTabsByGap(
  tabs: Tab[],
  fromId: number,
  toGapIndex: number,
): Tab[] {
  const moved = tabs.find((t) => t.id === fromId);
  if (!moved) return tabs;
  const sameSpace = tabs.filter((t) => t.spaceId === moved.spaceId);
  const spaceFrom = sameSpace.findIndex((t) => t.id === fromId);
  let spaceTarget = toGapIndex > spaceFrom ? toGapIndex - 1 : toGapIndex;
  spaceTarget = Math.max(0, Math.min(spaceTarget, sameSpace.length - 1));
  if (spaceTarget === spaceFrom) return tabs;
  const anchor = sameSpace[spaceTarget];
  const next = tabs.filter((t) => t.id !== fromId);
  const anchorIdx = next.findIndex((t) => t.id === anchor.id);
  const insertIdx = spaceTarget > spaceFrom ? anchorIdx + 1 : anchorIdx;
  next.splice(insertIdx, 0, moved);
  return next;
}

/**
 * Plans a Chrome-style "close tabs to the right" within the anchor's space.
 * Returns the ids strictly to the right of the anchor plus the id to keep
 * active: the anchor when the active tab is being closed, unchanged otherwise.
 */
export function planCloseTabsToRight(
  tabs: Tab[],
  anchorId: number,
  activeId: number,
): CloseTabsPlan {
  const anchor = tabs.find((t) => t.id === anchorId);
  if (!anchor) return { closeIds: [], nextActiveId: activeId };
  const sameSpace = tabs.filter((t) => t.spaceId === anchor.spaceId);
  const idx = sameSpace.findIndex((t) => t.id === anchorId);
  const closeIds = sameSpace
    .slice(idx + 1)
    .filter((t) => !t.locked)
    .map((t) => t.id);
  if (closeIds.length === 0) return { closeIds, nextActiveId: activeId };
  return {
    closeIds,
    nextActiveId: closeIds.includes(activeId) ? anchorId : activeId,
  };
}

/**
 * Plans a Chrome-style "close other tabs" within the anchor's space.
 * Returns every other tab's id in the anchor's space plus the id to keep
 * active: the anchor when the active tab is being closed, unchanged otherwise.
 */
export function planCloseOtherTabs(
  tabs: Tab[],
  anchorId: number,
  activeId: number,
): CloseTabsPlan {
  const anchor = tabs.find((t) => t.id === anchorId);
  if (!anchor) return { closeIds: [], nextActiveId: activeId };
  const sameSpace = tabs.filter((t) => t.spaceId === anchor.spaceId);
  const closeIds = sameSpace
    .filter((t) => t.id !== anchorId && !t.locked)
    .map((t) => t.id);
  if (closeIds.length === 0) return { closeIds, nextActiveId: activeId };
  return {
    closeIds,
    nextActiveId: closeIds.includes(activeId) ? anchorId : activeId,
  };
}

export function applyCloseTabsPlan(
  tabs: Tab[],
  anchorId: number,
  plan: CloseTabsPlan,
): CloseTabsPlanResult | null {
  const anchor = tabs.find((tab) => tab.id === anchorId);
  if (!anchor) return null;

  const requested = new Set(plan.closeIds);
  const closing = tabs.filter(
    (tab) =>
      tab.id !== anchorId &&
      tab.spaceId === anchor.spaceId &&
      !tab.locked &&
      requested.has(tab.id),
  );
  if (closing.length === 0) return null;

  const closeIds = closing.map((tab) => tab.id);
  const close = new Set(closeIds);
  const next = tabs.filter((tab) => !close.has(tab.id));
  const nextActiveId = next.some((tab) => tab.id === plan.nextActiveId)
    ? plan.nextActiveId
    : anchorId;
  const disposeLeafIds = closing
    .filter((tab) => tab.kind === "terminal")
    .flatMap((tab) => leafIds(tab.paneTree));

  return { tabs: next, closeIds, disposeLeafIds, nextActiveId };
}

export function planGitDiffOpen(
  tabs: Tab[],
  input: GitDiffOpenInput,
  spaceId: string,
  pin: boolean,
  allocId: () => number,
): { tabs: Tab[]; targetId: number } {
  const title = input.title ?? `${basename(input.path)} (${input.mode})`;
  const originalPath = input.originalPath ?? null;
  const matches = (tab: Tab): tab is GitDiffTab =>
    tab.kind === "git-diff" &&
    tab.spaceId === spaceId &&
    tab.repoRoot === input.repoRoot &&
    tab.path === input.path &&
    tab.mode === input.mode;
  const matchingTabs = tabs.filter(matches);
  const existing = matchingTabs.find((tab) => !tab.preview) ?? matchingTabs[0];

  if (existing) {
    const preview = pin ? false : existing.preview;
    if (
      existing.title === title &&
      existing.originalPath === originalPath &&
      existing.preview === preview
    ) {
      return { tabs, targetId: existing.id };
    }
    return {
      tabs: tabs.map((tab) =>
        tab.id === existing.id
          ? { ...existing, title, originalPath, preview }
          : tab,
      ),
      targetId: existing.id,
    };
  }

  const id = allocId();
  const tab = {
    id,
    ...createTabIdentity(spaceId),
    kind: "git-diff",
    spaceId,
    title,
    path: input.path,
    repoRoot: input.repoRoot,
    mode: input.mode,
    originalPath,
    preview: !pin,
    workspaceEnv: input.workspaceEnv,
  } satisfies GitDiffTab;

  if (pin) return { tabs: [...tabs, tab], targetId: id };

  const previewIndex = tabs.findIndex(
    (candidate) =>
      candidate.kind === "git-diff" &&
      candidate.spaceId === spaceId &&
      candidate.preview,
  );
  if (previewIndex === -1) return { tabs: [...tabs, tab], targetId: id };

  const next = [...tabs];
  next[previewIndex] = tab;
  return { tabs: next, targetId: id };
}

export function planCommitHistoryOpen(
  tabs: Tab[],
  input: {
    repoRoot: string;
    branch?: string | null;
    workspaceEnv?: WorkspaceEnv;
  },
  spaceId: string,
  allocId: () => number,
): { tabs: Tab[]; targetId: number } {
  const existing = tabs.find(
    (tab): tab is GitHistoryTab =>
      tab.kind === "git-history" &&
      tab.spaceId === spaceId &&
      tab.repoRoot === input.repoRoot,
  );
  const title = input.branch ? `History · ${input.branch}` : "Git History";
  if (existing) {
    if (existing.title === title) return { tabs, targetId: existing.id };
    return {
      tabs: tabs.map((tab) =>
        tab.id === existing.id
          ? {
              ...existing,
              title,
              workspaceEnv: input.workspaceEnv ?? existing.workspaceEnv,
            }
          : tab,
      ),
      targetId: existing.id,
    };
  }

  const id = allocId();
  return {
    tabs: [
      ...tabs,
      {
        id,
        ...createTabIdentity(spaceId),
        kind: "git-history",
        spaceId,
        title,
        repoRoot: input.repoRoot,
        workspaceEnv: input.workspaceEnv,
      } satisfies GitHistoryTab,
    ],
    targetId: id,
  };
}

function coldTerminalTab(
  tabId: number,
  leafId: number,
  spaceId: string,
  cwd?: string,
): TerminalTab {
  return {
    id: tabId,
    ...createTabIdentity(spaceId),
    kind: "terminal",
    spaceId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd,
    paneTree: { kind: "leaf", id: leafId, cwd },
    activeLeafId: leafId,
  };
}

// Plans the removal of a deleted space's tabs while keeping the invariant that
// the now-active `fallbackSpaceId` always has at least one tab (a cold one is
// spawned when it would be left empty). Returns null when nothing to remove.
export function planSpaceRemoval(
  tabs: Tab[],
  currentActiveId: number,
  spaceId: string,
  fallbackSpaceId: string,
  fallbackCwd: string | undefined,
  allocId: () => number,
): { tabs: Tab[]; disposeLeafIds: number[]; activeId: number } | null {
  const removed = tabs.filter((t) => t.spaceId === spaceId);
  if (removed.length === 0) return null;
  const disposeLeafIds = removed
    .filter((t) => t.kind === "terminal")
    .flatMap((t) => leafIds((t as TerminalTab).paneTree));
  let next = tabs.filter((t) => t.spaceId !== spaceId);
  let activeId = currentActiveId;
  if (!next.some((t) => t.spaceId === fallbackSpaceId)) {
    const tabId = allocId();
    next = [
      ...next,
      coldTerminalTab(tabId, allocId(), fallbackSpaceId, fallbackCwd),
    ];
    activeId = tabId;
  } else if (!next.some((t) => t.id === currentActiveId)) {
    const inFallback = next.filter((t) => t.spaceId === fallbackSpaceId);
    activeId = inFallback[inFallback.length - 1].id;
  }
  return { tabs: next, disposeLeafIds, activeId };
}

export type SingleTabCloseResult = {
  tabs: Tab[];
  disposeLeafIds: number[];
  nextActiveId: number;
};

export function planSingleTabClose(
  tabs: Tab[],
  closingId: number,
  currentActiveId: number,
  preferredNextId?: number | null,
): SingleTabCloseResult | null {
  const target = tabs.find((tab) => tab.id === closingId);
  if (!target || target.locked) return null;
  const next = tabs.filter((tab) => tab.id !== closingId);
  const localFallback = nextActiveInSpace(tabs, closingId);
  const preferred =
    preferredNextId !== undefined &&
    preferredNextId !== closingId &&
    next.some((tab) => tab.id === preferredNextId)
      ? preferredNextId
      : preferredNextId === null
        ? null
        : localFallback;
  const shouldMoveFocus =
    currentActiveId === closingId || preferredNextId !== undefined;
  return {
    tabs: next,
    disposeLeafIds:
      target.kind === "terminal" ? leafIds(target.paneTree) : [],
    nextActiveId: shouldMoveFocus
      ? (preferred ?? NO_ACTIVE_TAB_ID)
      : currentActiveId,
  };
}

export function useTabs(initial?: Partial<TerminalTab>) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const tabId = 1;
    const leafId = 2;
    return [
      {
        id: tabId,
        ...createTabIdentity(DEFAULT_SPACE_ID),
        kind: "terminal",
        spaceId: DEFAULT_SPACE_ID,
        cold: true,
        title: initial?.title ?? "shell",
        cwd: initial?.cwd,
        paneTree: { kind: "leaf", id: leafId, cwd: initial?.cwd },
        activeLeafId: leafId,
        workspaceEnv: LOCAL_WORKSPACE,
      },
    ];
  });
  const [activeId, setActiveId] = useState(1);
  // Gates warming until boot resolves the restore, so no shell spawns before it.
  const [booted, setBooted] = useState(false);
  const nextIdRef = useRef(3);
  const activeSpaceIdRef = useRef(DEFAULT_SPACE_ID);
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const recentlyClosedEditorsRef = useRef<ClosedEditor[]>([]);

  useLayoutEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useLayoutEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Activating a cold tab warms it: one choke point for every activation path.
  useEffect(() => {
    if (!booted) return;
    setTabs((curr) => {
      const t = curr.find((x) => x.id === activeId);
      if (!t?.cold) return curr;
      return curr.map((x) => (x.id === activeId ? { ...x, cold: false } : x));
    });
  }, [activeId, booted]);

  const warmTabs = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    const targetSet = new Set(ids);
    setTabs((curr) => {
      const hasCold = curr.some((x) => targetSet.has(x.id) && x.cold);
      if (!hasCold) return curr;
      return curr.map((x) =>
        targetSet.has(x.id) && x.cold ? { ...x, cold: false } : x,
      );
    });
  }, []);

  const allocId = useCallback(() => nextIdRef.current++, []);

  const markBooted = useCallback(() => setBooted(true), []);

  const setActiveSpaceForNewTabs = useCallback((spaceId: string) => {
    activeSpaceIdRef.current = spaceId;
  }, []);

  const replaceTabs = useCallback((next: Tab[], nextActiveId: number) => {
    tabsRef.current = next;
    activeIdRef.current = nextActiveId;
    setTabs(next);
    setActiveId(nextActiveId);
  }, []);

  // Appends a cold terminal tab to a space without stealing focus, so the
  // overview can populate a space in place; it spawns when first opened.
  const newTabInSpace = useCallback(
    (
      spaceId: string,
      cwd?: string,
      workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
    ) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      setTabs((curr) => [
        ...curr,
        {
          id: tabId,
          ...createTabIdentity(spaceId),
          kind: "terminal",
          spaceId,
          cold: true,
          title: cwd ? basename(cwd) : "shell",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          workspaceEnv,
        },
      ]);
      return tabId;
    },
    [],
  );

  // Reassigns a tab to another space. Returns true when the moved tab was active
  // and emptied its source space, so the caller should follow it into the target.
  const moveTabToSpace = useCallback(
    (tabId: number, targetSpaceId: string): boolean => {
      const curr = tabsRef.current;
      const tab = curr.find((t) => t.id === tabId);
      if (!tab || tab.spaceId === targetSpaceId) return false;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? ({
                ...t,
                spaceId: targetSpaceId,
                workspaceScopeId:
                  workspaceScopeIdFromLegacySpace(targetSpaceId),
              } as Tab)
            : t,
        ),
      );
      if (activeIdRef.current !== tabId) return false;
      const fallback = nextActiveInSpace(curr, tabId);
      if (fallback !== null) {
        setActiveId(fallback);
        return false;
      }
      return true;
    },
    [],
  );

  // Positions a tab next to a target tab, inheriting the target's space. Returns
  // true when the active tab crossed into the target space and emptied its
  // source, so the caller should follow it.
  const reorderTab = useCallback(
    (tabId: number, targetTabId: number, edge: "top" | "bottom"): boolean => {
      if (tabId === targetTabId) return false;
      const curr = tabsRef.current;
      const moved = curr.find((t) => t.id === tabId);
      const target = curr.find((t) => t.id === targetTabId);
      if (!moved || !target) return false;
      const crossSpace = moved.spaceId !== target.spaceId;
      setTabs((prev) => {
        const without = prev.filter((t) => t.id !== tabId);
        let idx = without.findIndex((t) => t.id === targetTabId);
        if (idx < 0) return prev;
        if (edge === "bottom") idx += 1;
        const next: Tab = crossSpace
          ? ({
              ...moved,
              spaceId: target.spaceId,
              workspaceScopeId: workspaceScopeIdFromLegacySpace(
                target.spaceId,
              ),
            } as Tab)
          : moved;
        without.splice(idx, 0, next);
        return without;
      });
      if (!crossSpace || activeIdRef.current !== tabId) return false;
      const fallback = nextActiveInSpace(curr, tabId);
      if (fallback !== null) {
        setActiveId(fallback);
        return false;
      }
      return true;
    },
    [],
  );

  const removeTabsForSpace = useCallback(
    (spaceId: string, fallbackSpaceId: string, fallbackCwd?: string) => {
      let toDispose: number[] = [];
      setTabs((curr) => {
        const plan = planSpaceRemoval(
          curr,
          activeIdRef.current,
          spaceId,
          fallbackSpaceId,
          fallbackCwd,
          () => nextIdRef.current++,
        );
        if (!plan) return curr;
        toDispose = plan.disposeLeafIds;
        setActiveId(plan.activeId);
        return plan.tabs;
      });
      for (const lid of toDispose) disposeSession(lid);
    },
    [],
  );

  const newTab = useCallback(
    (cwd?: string, workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title: "shell",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          workspaceEnv,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [],
  );

  const newBlockTab = useCallback(
    (cwd?: string, workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title: translate("tabs.subtitles.terminalBlocks"),
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          blocks: true,
          workspaceEnv,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [],
  );

  const newShellTab = useCallback(
    (shellPath: string, shellName: string, cwd?: string) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title: shellName || "shell",
          customTitle: shellName,
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          workspaceEnv: LOCAL_WORKSPACE,
          shellOverride: shellPath,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [],
  );

  const newWslTab = useCallback(
    (distro: string, cwd?: string) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      const env: WorkspaceEnv = { kind: "wsl", distro };
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title: `${distro} (WSL)`,
          customTitle: `${distro} (WSL)`,
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          workspaceEnv: env,
        },
      ]);
      setActiveId(tabId);
      return { tabId, leafId };
    },
    [],
  );

  useEffect(() => {
    if (!import.meta.env?.DEV || typeof window === "undefined") return;
    (
      window as unknown as { __vokttyNewBlockTab?: (cwd?: string) => number }
    ).__vokttyNewBlockTab = newBlockTab;
  }, [newBlockTab]);

  const newAgentGroupTab = useCallback(
    (
      cwd: string | undefined,
      title: string,
      instances: AgentInstanceCount,
      workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
    ) => {
      const tabId = nextIdRef.current++;
      const { paneTree, leafIds: agentLeafIds } = createAgentPanePlan(
        instances,
        () => nextIdRef.current++,
        cwd,
      );
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title,
          customTitle: title,
          cwd,
          paneTree,
          activeLeafId: agentLeafIds[0],
          workspaceEnv,
        },
      ]);
      setActiveId(tabId);
      return { tabId, leafIds: agentLeafIds };
    },
    [],
  );

  const newAgentTab = useCallback(
    (cwd: string | undefined, title: string) => {
      const { tabId, leafIds: agentLeafIds } = newAgentGroupTab(cwd, title, 1);
      return { tabId, leafId: agentLeafIds[0] };
    },
    [newAgentGroupTab],
  );

  const newSshTab = useCallback(
    (
      cwd: string | undefined,
      title: string,
      workspaceEnv: Extract<WorkspaceEnv, { kind: "ssh" }>,
    ) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title,
          customTitle: title,
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          workspaceEnv,
        },
      ]);
      setActiveId(tabId);
      return { tabId, leafId };
    },
    [],
  );

  const newSerialTab = useCallback(
    (config: SerialConnectionConfig) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      const title = `${config.portName} (${config.baudRate})`;
      const workspaceEnv: WorkspaceEnv = {
        kind: "serial",
        ...config,
      };
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title,
          customTitle: title,
          paneTree: { kind: "leaf", id: leafId },
          activeLeafId: leafId,
          workspaceEnv,
        },
      ]);
      setActiveId(tabId);
      return { tabId, leafId };
    },
    [],
  );

  const newGuestTerminalTab = useCallback(
    (credentials: GuestTerminalCredentials, title: string) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      registerGuestTerminal(leafId, credentials);
      setTabs((current) => [
        ...current,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title,
          customTitle: title,
          paneTree: { kind: "leaf", id: leafId },
          activeLeafId: leafId,
          workspaceEnv: LOCAL_WORKSPACE,
          collaboration: { mode: "guest" },
        },
      ]);
      setActiveId(tabId);
      return { tabId, leafId };
    },
    [],
  );

  const newDockerTab = useCallback(
    (connection: DockerWorkspaceConnection) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      const title = `🐳 ${connection.containerName}`;
      const workspaceEnv: Extract<WorkspaceEnv, { kind: "docker" }> = {
        kind: "docker",
        connection,
      };
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title,
          customTitle: title,
          cwd: connection.workdir || "/",
          paneTree: { kind: "leaf", id: leafId, cwd: connection.workdir || "/" },
          activeLeafId: leafId,
          workspaceEnv,
        },
      ]);
      setActiveId(tabId);
      return { tabId, leafId };
    },
    [],
  );

  const newPrivateTab = useCallback(
    (cwd?: string, workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      setTabs((t) => [
        ...t,
        {
          id: tabId,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title: translate("tabs.subtitles.privateTerminal"),
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          private: true,
          workspaceEnv,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [],
  );

  const duplicateTab = useCallback(
    (id: number, workspaceEnv?: WorkspaceEnv) => {
      const source = tabsRef.current.find((tab) => tab.id === id);
      if (!source || source.kind !== "terminal" || source.collaboration) {
        return null;
      }
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      const env = workspaceEnv ?? source.workspaceEnv ?? LOCAL_WORKSPACE;
      setTabs((curr) => [
        ...curr,
        {
          id: tabId,
          ...createTabIdentity(source.spaceId),
          kind: "terminal",
          spaceId: source.spaceId,
          title: source.title,
          customTitle: source.customTitle,
          cwd: source.cwd,
          paneTree: { kind: "leaf", id: leafId, cwd: source.cwd },
          activeLeafId: leafId,
          blocks: source.blocks,
          workspaceEnv: env,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [],
  );

  /**
   * Opens a file in an editor tab.
   *
   * - `pin = true` (default) — opens or activates a **persistent** tab.
   *   If the path is currently in the preview slot it is promoted in-place.
   *   Use this for programmatic opens (AI diff, New File dialog, etc.).
   * - `pin = false` — VSCode-style **preview** tab. A single shared slot is
   *   reused: if a persistent tab for the path already exists it is activated;
   *   otherwise the current preview slot is replaced with the new path.
   */
  const openFileTab = useCallback(
    (path: string, pin = true, options: OpenFileTabOptions = {}) => {
      const targetSpaceId = options.spaceId ?? activeSpaceIdRef.current;
      const activate = options.activate ?? true;
      const plan = planFileTabOpen(
        tabsRef.current,
        path,
        pin,
        targetSpaceId,
        () => nextIdRef.current++,
        options.workspaceEnv ?? currentWorkspaceEnv(),
      );
      tabsRef.current = plan.tabs;
      setTabs(plan.tabs);
      if (activate) setActiveId(plan.tabId);
      return plan.tabId;
    },
    [],
  );

  /**
   * Promotes a preview tab to a persistent one. Called on double-click of the
   * tab title in the tab bar. Dirty editor tabs also auto-promote.
   */
  const pinTab = useCallback((id: number) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== id) return t;
        if ((t.kind === "editor" || t.kind === "git-diff") && t.preview) {
          return { ...t, preview: false };
        }
        return t;
      }),
    );
  }, []);

  const openAiDiffTab = useCallback(
    (input: {
      path: string;
      originalContent: string;
      proposedContent: string;
      approvalId: string;
      isNewFile: boolean;
    }) => {
      let targetId: number | null = null;
      setTabs((curr) => {
        const existing = curr.find(
          (t) => t.kind === "ai-diff" && t.approvalId === input.approvalId,
        );
        if (existing) {
          targetId = existing.id;
          return curr;
        }
        const id = nextIdRef.current++;
        targetId = id;
        const title = `${basename(input.path)} (AI diff)`;
        return [
          ...curr,
          {
            id,
            ...createTabIdentity(activeSpaceIdRef.current),
            kind: "ai-diff",
            spaceId: activeSpaceIdRef.current,
            title,
            path: input.path,
            originalContent: input.originalContent,
            proposedContent: input.proposedContent,
            approvalId: input.approvalId,
            status: "pending",
            isNewFile: input.isNewFile,
          },
        ];
      });
      if (targetId !== null) setActiveId(targetId);
      return targetId as number | null;
    },
    [],
  );

  const setAiDiffStatus = useCallback(
    (approvalId: string, status: AiDiffStatus) => {
      setTabs((curr) =>
        curr.map((t) =>
          t.kind === "ai-diff" && t.approvalId === approvalId
            ? { ...t, status }
            : t,
        ),
      );
    },
    [],
  );

  const closeAiDiffTab = useCallback((approvalId: string) => {
    setTabs((curr) => {
      const target = curr.find(
        (t) => t.kind === "ai-diff" && t.approvalId === approvalId,
      );
      if (!target) return curr;
      const fallback = nextActiveInSpace(curr, target.id);
      if (fallback === null) {
        return curr.map((t) =>
          t.kind === "ai-diff" && t.approvalId === approvalId
            ? { ...t, status: "approved" as AiDiffStatus }
            : t,
        );
      }
      const next = curr.filter((t) => t.id !== target.id);
      setActiveId((active) => (target.id === active ? fallback : active));
      return next;
    });
  }, []);

  const newPreviewTab = useCallback(
    (url: string, options?: { devServerScope?: string }) => {
      const id = nextIdRef.current++;
      setTabs((t) => [
        ...t,
        {
          id,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "preview",
          spaceId: activeSpaceIdRef.current,
          title: titleFromUrl(url),
          url,
          ...(options?.devServerScope
            ? { devServerScope: options.devServerScope }
            : {}),
        },
      ]);
      setActiveId(id);
      return id;
    },
    [],
  );

  const newRdpTab = useCallback(
    (options?: {
      host?: string;
      port?: number;
      username?: string;
      domain?: string;
      autoConnect?: boolean;
    }) => {
      const id = nextIdRef.current++;
      const host = options?.host || "";
      const title = host ? `RDP: ${host}` : "Remote Desktop";
      setTabs((t) => [
        ...t,
        {
          id,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "rdp",
          spaceId: activeSpaceIdRef.current,
          title,
          host,
          port: options?.port || 3389,
          username: options?.username,
          domain: options?.domain,
          autoConnect: options?.autoConnect ?? Boolean(host),
        },
      ]);
      setActiveId(id);
      return id;
    },
    [],
  );

  // Mirrors tabsRef like openFileTab instead of using a functional update: a
  // batch that opens a markdown file before a regular one (multi-file "Open
  // With") would otherwise have the queued markdown update clobbered by
  // openFileTab's setTabs(plan.tabs), which is built from the stale ref.
  const newMarkdownTab = useCallback(
    (path: string, options: OpenFileTabOptions = {}) => {
    const curr = tabsRef.current;
    const plan = planMarkdownTabOpen(
      curr,
      path,
      options.spaceId ?? activeSpaceIdRef.current,
      () => nextIdRef.current++,
      options.workspaceEnv ?? currentWorkspaceEnv(),
    );
    if (plan.tabs !== curr) {
      tabsRef.current = plan.tabs;
      setTabs(plan.tabs);
    }
    if (options.activate ?? true) setActiveId(plan.tabId);
    return plan.tabId;
    },
    [],
  );

  const setOverrideLanguage = useCallback((id: number, lang: string | null) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== id || t.kind !== "editor") return t;
        return {
          ...t,
          overrideLanguage: lang,
        };
      }),
    );
  }, []);

  const setMarkdownView = useCallback(
    (id: number, mode: "rendered" | "raw") => {
      setTabs((curr) =>
        curr.map((t) => {
          if (
            t.id !== id ||
            !isMarkdownPath((t as { path?: string }).path ?? "")
          )
            return t;
          if (mode === "raw" && t.kind === "markdown") {
            return {
              ...t,
              kind: "editor" as const,
              dirty: false,
              preview: false,
              overrideLanguage:
                (t as { overrideLanguage?: string | null }).overrideLanguage ??
                null,
            };
          }
          if (mode === "rendered" && t.kind === "editor") {
            if (t.dirty) return t;
            return {
              id: t.id,
              tabKey: t.tabKey,
              workspaceScopeId: t.workspaceScopeId,
              kind: "markdown" as const,
              spaceId: t.spaceId,
              cold: t.cold,
              title: t.title,
              path: t.path,
              overrideLanguage: t.overrideLanguage ?? null,
            };
          }
          return t;
        }),
      );
    },
    [],
  );

  const openGitDiffTab = useCallback((input: GitDiffOpenInput, pin = false) => {
    const curr = tabsRef.current;
    const plan = planGitDiffOpen(
      curr,
      input,
      activeSpaceIdRef.current,
      pin,
      () => nextIdRef.current++,
    );
    if (plan.tabs !== curr) {
      tabsRef.current = plan.tabs;
      setTabs(plan.tabs);
    }
    setActiveId(plan.targetId);
    return plan.targetId;
  }, []);

  const openCommitHistoryTab = useCallback(
    (input: {
      repoRoot: string;
      branch?: string | null;
      workspaceEnv?: WorkspaceEnv;
    }) => {
      const curr = tabsRef.current;
      const plan = planCommitHistoryOpen(
        curr,
        input,
        activeSpaceIdRef.current,
        () => nextIdRef.current++,
      );
      if (plan.tabs !== curr) {
        tabsRef.current = plan.tabs;
        setTabs(plan.tabs);
      }
      setActiveId(plan.targetId);
      return plan.targetId;
    },
    [],
  );

  const openCommitFileDiffTab = useCallback(
    (input: {
      repoRoot: string;
      sha: string;
      shortSha: string;
      subject: string;
      path: string;
      originalPath: string | null;
      workspaceEnv?: WorkspaceEnv;
    }) => {
      const curr = tabsRef.current;
      const existing = curr.find(
        (t): t is GitCommitFileDiffTab =>
          t.kind === "git-commit-file" &&
          t.repoRoot === input.repoRoot &&
          t.sha === input.sha &&
          t.path === input.path,
      );
      const title = `${basename(input.path)} @ ${input.shortSha}`;
      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id
            ? {
                ...existing,
                title,
                subject: input.subject,
                originalPath: input.originalPath,
                workspaceEnv: input.workspaceEnv ?? existing.workspaceEnv,
              }
            : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }
      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          ...createTabIdentity(activeSpaceIdRef.current),
          kind: "git-commit-file",
          spaceId: activeSpaceIdRef.current,
          title,
          repoRoot: input.repoRoot,
          sha: input.sha,
          shortSha: input.shortSha,
          subject: input.subject,
          path: input.path,
          originalPath: input.originalPath,
          workspaceEnv: input.workspaceEnv,
        } satisfies GitCommitFileDiffTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const newApiClientTab = useCallback((spaceId?: string) => {
    const targetSpace = spaceId ?? activeSpaceIdRef.current;
    const curr = tabsRef.current;
    const existing = curr.find(
      (t): t is ApiClientTab => t.kind === "api-client" && t.spaceId === targetSpace,
    );
    if (existing) {
      setActiveId(existing.id);
      return existing.id;
    }
    const id = nextIdRef.current++;
    const nextTabs: Tab[] = [
      ...curr,
      {
        id,
        ...createTabIdentity(targetSpace),
        kind: "api-client",
        spaceId: targetSpace,
        title: "API Client",
      },
    ];
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setActiveId(id);
    return id;
  }, []);

  const closeTab = useCallback((id: number, preferredNextId?: number | null) => {
    const editor = tabsRef.current.find(
      (tab): tab is EditorTab =>
        tab.id === id && tab.kind === "editor" && !tab.locked,
    );
    if (editor) {
      recentlyClosedEditorsRef.current = pushClosedEditor(
        recentlyClosedEditorsRef.current,
        {
          path: editor.path,
          spaceId: editor.spaceId,
          overrideLanguage: editor.overrideLanguage ?? null,
          workspaceEnv: editor.workspaceEnv,
        },
      );
    }
    const result = planSingleTabClose(
      tabsRef.current,
      id,
      activeIdRef.current,
      preferredNextId,
    );
    if (!result) return;
    tabsRef.current = result.tabs;
    activeIdRef.current = result.nextActiveId;
    setTabs(result.tabs);
    setActiveId(result.nextActiveId);
    for (const lid of result.disposeLeafIds) disposeSession(lid);
  }, []);

  const closeTabs = useCallback(
    (anchorId: number, plan: CloseTabsPlan): number[] => {
      const result = applyCloseTabsPlan(tabsRef.current, anchorId, plan);
      if (!result) return [];
      for (const tab of tabsRef.current) {
        if (tab.kind !== "editor" || !result.closeIds.includes(tab.id)) continue;
        recentlyClosedEditorsRef.current = pushClosedEditor(
          recentlyClosedEditorsRef.current,
          {
            path: tab.path,
            spaceId: tab.spaceId,
            overrideLanguage: tab.overrideLanguage ?? null,
            workspaceEnv: tab.workspaceEnv,
          },
        );
      }
      tabsRef.current = result.tabs;
      activeIdRef.current = result.nextActiveId;
      setTabs(result.tabs);
      setActiveId(result.nextActiveId);
      for (const leafId of result.disposeLeafIds) disposeSession(leafId);
      return result.closeIds;
    },
    [],
  );

  const reopenClosedEditor = useCallback((): number | null => {
    const result = takeClosedEditor(recentlyClosedEditorsRef.current);
    recentlyClosedEditorsRef.current = result.stack;
    if (!result.editor) return null;
    const tabId = openFileTab(result.editor.path, true, {
      spaceId: result.editor.spaceId,
      workspaceEnv: result.editor.workspaceEnv,
    });
    if (result.editor.overrideLanguage) {
      const next = tabsRef.current.map((tab) =>
        tab.id === tabId && tab.kind === "editor"
          ? { ...tab, overrideLanguage: result.editor?.overrideLanguage }
          : tab,
      );
      tabsRef.current = next;
      setTabs(next);
    }
    return tabId;
  }, [openFileTab]);

  const updateTab = useCallback((id: number, patch: TabPatch) => {
    setTabs((t) =>
      t.map((x) => {
        if (x.id !== id) return x;
        const basePatch = {
          ...(patch.color !== undefined && { color: patch.color }),
          ...(patch.locked !== undefined && { locked: patch.locked }),
        };
        if (x.kind === "terminal") {
          return {
            ...x,
            ...basePatch,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.cwd !== undefined && { cwd: patch.cwd }),
            ...(patch.customTitle !== undefined && {
              customTitle:
                patch.customTitle === "" ? undefined : patch.customTitle,
            }),
            ...(patch.workspaceEnv !== undefined && {
              workspaceEnv: patch.workspaceEnv,
            }),
          };
        }
        if (x.kind === "preview") {
          return {
            ...x,
            ...basePatch,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.url !== undefined && {
              url: patch.url,
              title: patch.title ?? titleFromUrl(patch.url),
            }),
            ...(patch.devServerScope !== undefined && {
              devServerScope: patch.devServerScope || undefined,
            }),
          };
        }
        if (x.kind === "markdown") {
          return {
            ...x,
            ...basePatch,
            ...(patch.title !== undefined && { title: patch.title }),
          };
        }
        if (x.kind === "rdp") {
          return {
            ...x,
            ...basePatch,
            ...(patch.title !== undefined && { title: patch.title }),
          };
        }
        // editor tab: auto-promote from preview the moment the file becomes dirty.
        const autoPin =
          patch.dirty === true && (x as EditorTab).preview
            ? { preview: false }
            : {};
        return {
          ...x,
          ...basePatch,
          ...autoPin,
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.dirty !== undefined && { dirty: patch.dirty }),
          ...(patch.path !== undefined && { path: patch.path }),
          ...(patch.overrideLanguage !== undefined && {
            overrideLanguage: patch.overrideLanguage,
          }),
        };
      }),
    );
  }, []);

  const selectByIndex = useCallback(
    (idx: number, spaceId?: string) => {
      const t = spaceId ? pickTabBySpaceIndex(tabs, idx, spaceId) : tabs[idx];
      if (t) setActiveId(t.id);
    },
    [tabs],
  );

  /** Update a leaf's cwd; mirror to the tab's `cwd` when the leaf is active.
   * Bails out without setTabs when nothing actually changed — shell integration
   * re-emits OSC 7 on every prompt, including empty Enters, so this fires at
   * keystroke rate. Always-setTabs there cascades a paneTree re-render across
   * every open tab. */
  const setLeafCwd = useCallback((leafId: number, cwd: string) => {
    setTabs((curr) => {
      let changed = false;
      const next = curr.map((t) => {
        if (t.kind !== "terminal" || !hasLeaf(t.paneTree, leafId)) return t;
        const paneTree = setLeafCwdInTree(t.paneTree, leafId, cwd);
        const isActive = t.activeLeafId === leafId;
        const cwdChanged = isActive && t.cwd !== cwd;
        if (paneTree === t.paneTree && !cwdChanged) return t;
        changed = true;
        return { ...t, paneTree, ...(cwdChanged && { cwd }) };
      });
      return changed ? next : curr;
    });
  }, []);

  const focusPane = useCallback((tabId: number, leafId: number) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        if (!hasLeaf(t.paneTree, leafId)) return t;
        if (t.activeLeafId === leafId) return t;
        const cwd = findLeafCwd(t.paneTree, leafId);
        return {
          ...t,
          activeLeafId: leafId,
          ...(cwd !== undefined && { cwd }),
        };
      }),
    );
  }, []);

  const focusNextPaneInTab = useCallback((tabId: number, delta: 1 | -1) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        const next = nextLeafId(t.paneTree, t.activeLeafId, delta);
        if (next === t.activeLeafId) return t;
        const cwd = findLeafCwd(t.paneTree, next);
        return { ...t, activeLeafId: next, ...(cwd !== undefined && { cwd }) };
      }),
    );
  }, []);

  const swapActivePaneInDirection = useCallback(
    (tabId: number, direction: PaneDirection, bounds?: PaneBounds[]) => {
      setTabs((curr) =>
        curr.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal") return t;
          const paneTree = swapLeafInDirection(
            t.paneTree,
            t.activeLeafId,
            direction,
            bounds,
          );
          return paneTree === t.paneTree ? t : { ...t, paneTree };
        }),
      );
    },
    [],
  );

  /** Split the active leaf of `tabId` along `dir`. Returns the new leaf id. */
  const splitActivePane = useCallback(
    (tabId: number, dir: SplitDir): number | null => {
      let newLeafId: number | null = null;
      setTabs((curr) =>
        curr.map((t) => {
          if (
            t.id !== tabId ||
            t.kind !== "terminal" ||
            t.blocks ||
            t.collaboration
          ) {
            return t;
          }
          if (leafIds(t.paneTree).length >= MAX_PANES_PER_TAB) return t;
          const splitId = nextIdRef.current++;
          const leafId = nextIdRef.current++;
          newLeafId = leafId;
          const paneTree = splitLeaf(
            t.paneTree,
            t.activeLeafId,
            splitId,
            leafId,
            dir,
            t.cwd,
          );
          return { ...t, paneTree, activeLeafId: leafId };
        }),
      );
      return newLeafId;
    },
    [],
  );

  const closePaneByLeaf = useCallback((leafId: number): void => {
    let didRemove = false;
    setTabs((curr) => {
      const tab = curr.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab?.kind !== "terminal") return curr;
      const newTree = removeLeaf(tab.paneTree, leafId);
      if (newTree === null) {
        const fallback = nextActiveInSpace(curr, tab.id);
        if (fallback === null) return curr;
        const next = curr.filter((x) => x.id !== tab.id);
        setActiveId((active) => (active === tab.id ? fallback : active));
        didRemove = true;
        return next;
      }
      const remaining = leafIds(newTree);
      let newActive = tab.activeLeafId;
      if (tab.activeLeafId === leafId) {
        const sib = siblingLeafOf(tab.paneTree, leafId);
        newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      }
      didRemove = true;
      return curr.map((x) =>
        x.id === tab.id
          ? { ...x, paneTree: newTree, activeLeafId: newActive }
          : x,
      );
    });
    if (didRemove) disposeSession(leafId);
  }, []);

  const closeActivePane = useCallback((tabId: number): boolean => {
    let closedTab = false;
    let removedLeaf: number | null = null;
    setTabs((curr) => {
      const t = curr.find((x) => x.id === tabId);
      if (t?.kind !== "terminal") return curr;
      const target = t.activeLeafId;
      const newTree = removeLeaf(t.paneTree, target);
      if (newTree === null) {
        const fallback = nextActiveInSpace(curr, tabId);
        if (fallback === null) return curr;
        const next = curr.filter((x) => x.id !== tabId);
        setActiveId((active) => (active === tabId ? fallback : active));
        closedTab = true;
        removedLeaf = target;
        return next;
      }
      const remaining = leafIds(newTree);
      const sib = siblingLeafOf(t.paneTree, target);
      const newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      removedLeaf = target;
      return curr.map((x) =>
        x.id === tabId
          ? { ...x, paneTree: newTree, activeLeafId: newActive }
          : x,
      );
    });
    if (removedLeaf !== null) disposeSession(removedLeaf);
    return closedTab;
  }, []);

  const resetWorkspace = useCallback(
    (cwd?: string, workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      let toDispose: number[] = [];
      setTabs((curr) => {
        toDispose = curr.flatMap((t) =>
          t.kind === "terminal" ? leafIds(t.paneTree) : [],
        );
        return [
          {
            id: tabId,
            ...createTabIdentity(activeSpaceIdRef.current),
            kind: "terminal",
            spaceId: activeSpaceIdRef.current,
            title: "shell",
            cwd,
            paneTree: { kind: "leaf", id: leafId, cwd },
            activeLeafId: leafId,
            workspaceEnv,
          },
        ];
      });
      setActiveId(tabId);
      for (const lid of toDispose) disposeSession(lid);
    },
    [],
  );

  const reorderTabByGap = useCallback((fromId: number, toGapIndex: number) => {
    setTabs((prev) => reorderTabsByGap(prev, fromId, toGapIndex));
  }, []);

  const toggleTabBlocks = useCallback((tabId: number) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        return {
          ...t,
          blocks: !t.blocks,
        };
      }),
    );
  }, []);

  return {
    tabs,
    activeId,
    setActiveId,
    allocId,
    booted,
    replaceTabs,
    warmTabs,
    moveTabToSpace,
    reorderTab,
    reorderTabByGap,
    newTabInSpace,
    removeTabsForSpace,
    markBooted,
    setActiveSpaceForNewTabs,
    setOverrideLanguage,
    newTab,
    newBlockTab,
    newAgentTab,
    newAgentGroupTab,
    newSshTab,
    newSerialTab,
    newGuestTerminalTab,
    newDockerTab,
    newShellTab,
    newWslTab,
    duplicateTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    newRdpTab,
    newApiClientTab,
    setMarkdownView,
    openAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    setAiDiffStatus,
    closeAiDiffTab,
    closeTab,
    closeTabs,
    reopenClosedEditor,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    swapActivePaneInDirection,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    toggleTabBlocks,
    resetWorkspace,
  };
}
