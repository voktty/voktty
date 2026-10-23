import { t } from "@/modules/i18n";
import { isTabIconId, type TabIconId } from "@/modules/tabs/lib/tabIcon";
import { terminalProjectMetadata } from "@/modules/tabs/lib/terminalProject";
import {
  asWorkspaceScopeId,
  createTabIdentity,
  createTabKey,
  resolveTabKey,
  workspaceScopeIdFromLegacySpace,
} from "@/modules/tabs/lib/tabIdentity";
import type {
  EditorTab,
  HarnessTab,
  MarkdownTab,
  PreviewTab,
  Tab,
  TerminalTab,
} from "@/modules/tabs/lib/useTabs";
import {
  isLeaf,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import {
  LOCAL_WORKSPACE,
  persistentWorkspaceEnv,
  type WorkspaceEnv,
  workspaceForDocumentPath,
} from "@/modules/workspace";

export type SerializedNode =
  | { kind: "leaf"; cwd?: string; active?: boolean }
  | { kind: "split"; dir: SplitDir; children: SerializedNode[] };

export type SerializedTab = (
  | {
      kind: "terminal";
      projectCwd?: string;
      tree: SerializedNode;
      blocks?: boolean;
      customTitle?: string;
      workspaceEnv?: WorkspaceEnv;
    }
  | { kind: "harness"; cwd?: string; sessionId?: string }
  | { kind: "editor"; path: string; workspaceEnv?: WorkspaceEnv }
  | { kind: "preview"; url: string; devServerScope?: string }
  | { kind: "markdown"; path: string; workspaceEnv?: WorkspaceEnv }
) & {
  tabKey?: string;
  workspaceScopeId?: string;
  color?: string;
  icon?: TabIconId;
  locked?: boolean;
};

export function isSerializedHarnessTab(
  value: unknown,
): value is Extract<SerializedTab, { kind: "harness" }> {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  return (
    tab.kind === "harness" &&
    (tab.cwd === undefined || typeof tab.cwd === "string") &&
    (tab.sessionId === undefined ||
      (typeof tab.sessionId === "string" &&
        tab.sessionId.length <= 256 &&
        /\S/u.test(tab.sessionId)))
  );
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "preview";
  }
}

function serializeNode(node: PaneNode, activeLeafId: number): SerializedNode {
  if (isLeaf(node)) {
    return {
      kind: "leaf",
      ...(node.cwd !== undefined && { cwd: node.cwd }),
      ...(node.id === activeLeafId && { active: true }),
    };
  }
  return {
    kind: "split",
    dir: node.dir,
    children: node.children.map((c) => serializeNode(c, activeLeafId)),
  };
}

export function isSerializableTab(tab: Tab): boolean {
  if ("workspaceEnv" in tab && tab.workspaceEnv?.kind === "ssh") return false;
  switch (tab.kind) {
    case "terminal":
      return !tab.private && !tab.collaboration;
    case "harness":
    case "editor":
    case "preview":
    case "markdown":
      return true;
    default:
      return false;
  }
}

function serializeTab(tab: Tab): SerializedTab | null {
  if (!isSerializableTab(tab)) return null;
  const baseProps = {
    tabKey: tab.tabKey,
    workspaceScopeId: tab.workspaceScopeId,
    ...(tab.color ? { color: tab.color } : {}),
    ...(tab.icon ? { icon: tab.icon } : {}),
    ...(tab.locked ? { locked: true } : {}),
  };
  switch (tab.kind) {
    case "harness":
      return {
        kind: "harness",
        ...baseProps,
        ...(tab.cwd !== undefined && { cwd: tab.cwd }),
        ...(tab.sessionId !== undefined && { sessionId: tab.sessionId }),
      };
    case "terminal":
      return {
        kind: "terminal",
        ...terminalProjectMetadata(
          tab.projectCwd,
          tab.workspaceEnv ?? LOCAL_WORKSPACE,
        ),
        tree: serializeNode(tab.paneTree, tab.activeLeafId),
        ...(tab.blocks && { blocks: true }),
        ...(tab.customTitle !== undefined && { customTitle: tab.customTitle }),
        ...(tab.workspaceEnv && {
          workspaceEnv: persistentWorkspaceEnv(tab.workspaceEnv),
        }),
        ...baseProps,
      };
    case "editor":
      return {
        kind: "editor",
        path: tab.path,
        ...(tab.workspaceEnv && {
          workspaceEnv: persistentWorkspaceEnv(tab.workspaceEnv),
        }),
        ...baseProps,
      };
    case "preview":
      return {
        kind: "preview",
        url: tab.url,
        ...(tab.devServerScope ? { devServerScope: tab.devServerScope } : {}),
        ...baseProps,
      };
    case "markdown":
      return {
        kind: "markdown",
        path: tab.path,
        ...(tab.workspaceEnv && {
          workspaceEnv: persistentWorkspaceEnv(tab.workspaceEnv),
        }),
        ...baseProps,
      };
    default:
      return null;
  }
}

function hydrateIdentity(s: SerializedTab, legacySpaceId: string) {
  return {
    tabKey: resolveTabKey(s.tabKey),
    workspaceScopeId:
      typeof s.workspaceScopeId === "string" && s.workspaceScopeId.length > 0
        ? asWorkspaceScopeId(s.workspaceScopeId)
        : workspaceScopeIdFromLegacySpace(legacySpaceId),
  };
}

export function serializeTabs(tabs: Tab[]): SerializedTab[] {
  const out: SerializedTab[] = [];
  for (const tab of tabs) {
    const s = serializeTab(tab);
    if (s) out.push(s);
  }
  return out;
}

type HydratedTree = {
  tree: PaneNode;
  activeLeafId: number;
  firstLeafCwd?: string;
};

function hydrateNode(
  node: SerializedNode,
  allocId: () => number,
  acc: { activeLeafId: number | null },
): PaneNode {
  if (node.kind === "leaf") {
    const id = allocId();
    if (node.active && acc.activeLeafId === null) acc.activeLeafId = id;
    return {
      kind: "leaf",
      id,
      ...(node.cwd !== undefined && { cwd: node.cwd }),
    };
  }
  const children = node.children.map((c) => hydrateNode(c, allocId, acc));
  if (children.length === 0) return { kind: "leaf", id: allocId() };
  if (children.length === 1) return children[0];
  return { kind: "split", id: allocId(), dir: node.dir, children };
}

function hydrateTree(
  tree: SerializedNode,
  allocId: () => number,
): HydratedTree {
  const acc: { activeLeafId: number | null } = { activeLeafId: null };
  const paneTree = hydrateNode(tree, allocId, acc);
  const leaves = collectLeaves(paneTree);
  const activeLeafId = acc.activeLeafId ?? leaves[0]?.id ?? allocId();
  const firstLeafCwd =
    leaves.find((l) => l.id === activeLeafId)?.cwd ?? leaves[0]?.cwd;
  return { tree: paneTree, activeLeafId, firstLeafCwd };
}

function collectLeaves(node: PaneNode): Array<{ id: number; cwd?: string }> {
  if (isLeaf(node)) return [{ id: node.id, cwd: node.cwd }];
  return node.children.flatMap(collectLeaves);
}

function hydrateTab(
  s: SerializedTab,
  spaceId: string,
  allocId: () => number,
  fallbackWorkspaceEnv: WorkspaceEnv,
): Tab | null {
  if ("workspaceEnv" in s && s.workspaceEnv?.kind === "ssh") {
    return null;
  }
  switch (s.kind) {
    case "harness":
      if (!isSerializedHarnessTab(s)) return null;
      return {
        ...freshHarnessTab(spaceId, s.cwd ?? null, allocId),
        ...hydrateIdentity(s, spaceId),
        ...(s.sessionId !== undefined && { sessionId: s.sessionId }),
        ...(typeof s.color === "string" && s.color ? { color: s.color } : {}),
        ...(isTabIconId(s.icon) ? { icon: s.icon } : {}),
        ...(s.locked === true ? { locked: true } : {}),
      };
    case "terminal": {
      const { tree, activeLeafId, firstLeafCwd } = hydrateTree(s.tree, allocId);
      const title =
        s.customTitle ??
        (firstLeafCwd ? basename(firstLeafCwd) : s.blocks ? "blocks" : "shell");
      return {
        id: allocId(),
        ...hydrateIdentity(s, spaceId),
        kind: "terminal",
        ...terminalProjectMetadata(
          s.projectCwd,
          s.workspaceEnv ?? fallbackWorkspaceEnv,
        ),
        spaceId,
        cold: true,
        title,
        cwd: firstLeafCwd,
        paneTree: tree,
        activeLeafId,
        ...(s.blocks && { blocks: true }),
        ...(s.customTitle !== undefined && { customTitle: s.customTitle }),
        ...(s.workspaceEnv && { workspaceEnv: s.workspaceEnv }),
        ...(s.color ? { color: s.color } : {}),
        ...(isTabIconId(s.icon) ? { icon: s.icon } : {}),
        ...(s.locked ? { locked: true } : {}),
      } satisfies TerminalTab;
    }
    case "editor":
      return {
        id: allocId(),
        ...hydrateIdentity(s, spaceId),
        kind: "editor",
        spaceId,
        cold: true,
        title: basename(s.path),
        path: s.path,
        dirty: false,
        preview: false,
        workspaceEnv: workspaceForDocumentPath(
          s.workspaceEnv ?? fallbackWorkspaceEnv,
          s.path,
        ),
        ...(s.color ? { color: s.color } : {}),
        ...(isTabIconId(s.icon) ? { icon: s.icon } : {}),
        ...(s.locked ? { locked: true } : {}),
      } satisfies EditorTab;
    case "preview":
      return {
        id: allocId(),
        ...hydrateIdentity(s, spaceId),
        kind: "preview",
        spaceId,
        cold: true,
        title: titleFromUrl(s.url),
        url: s.url,
        ...(typeof s.devServerScope === "string" && s.devServerScope
          ? { devServerScope: s.devServerScope }
          : {}),
        ...(s.color ? { color: s.color } : {}),
        ...(isTabIconId(s.icon) ? { icon: s.icon } : {}),
        ...(s.locked ? { locked: true } : {}),
      } satisfies PreviewTab;
    case "markdown":
      return {
        id: allocId(),
        ...hydrateIdentity(s, spaceId),
        kind: "markdown",
        spaceId,
        cold: true,
        title: basename(s.path),
        path: s.path,
        workspaceEnv: workspaceForDocumentPath(
          s.workspaceEnv ?? fallbackWorkspaceEnv,
          s.path,
        ),
        ...(s.color ? { color: s.color } : {}),
        ...(isTabIconId(s.icon) ? { icon: s.icon } : {}),
        ...(s.locked ? { locked: true } : {}),
      } satisfies MarkdownTab;
    default:
      return null;
  }
}

export function freshHarnessTab(
  spaceId: string,
  cwd: string | null,
  allocId: () => number,
): HarnessTab {
  return {
    id: allocId(),
    ...createTabIdentity(spaceId),
    kind: "harness",
    spaceId,
    cold: true,
    title: t("harness.agentDevelopment"),
    ...(cwd !== null && { cwd }),
  };
}

export function freshTerminalTab(
  spaceId: string,
  cwd: string | null,
  allocId: () => number,
): TerminalTab {
  const leafId = allocId();
  return {
    id: allocId(),
    ...createTabIdentity(spaceId),
    kind: "terminal",
    spaceId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd: cwd ?? undefined,
    paneTree: { kind: "leaf", id: leafId, ...(cwd && { cwd }) },
    activeLeafId: leafId,
  };
}

export function hydrateTabs(
  serialized: SerializedTab[],
  spaceId: string,
  allocId: () => number,
  fallbackWorkspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
): Tab[] {
  if (!Array.isArray(serialized)) return [];
  const out: Tab[] = [];
  const tabKeys = new Set<string>();
  for (const s of serialized) {
    try {
      let tab = hydrateTab(s, spaceId, allocId, fallbackWorkspaceEnv);
      if (!tab) continue;
      while (tabKeys.has(tab.tabKey)) {
        tab = { ...tab, tabKey: createTabKey() };
      }
      tabKeys.add(tab.tabKey);
      out.push(tab);
    } catch {
      // Skip corrupted entries rather than failing the whole restore.
    }
  }
  return out;
}
