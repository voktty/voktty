import {
  asTabKey,
  asWorkspaceScopeId,
  createTabKey,
  isTabKey,
  resolveTabKey,
  type TabKey,
} from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  LOCAL_WORKSPACE,
  persistentWorkspaceEnv,
  type WorkspaceEnv,
} from "@/modules/workspace";
import {
  isSerializableTab,
  type SerializedNode,
  type SerializedTab,
  serializeTabs,
} from "./serialize";
import {
  asSlotId,
  asViewSpaceId,
  collectLayoutSlots,
  type SpaceLayoutNode,
  type ViewSpace,
} from "./spaceLayout";
import type { ActiveStripItem, StripEntry } from "./spaceProjection";

export const SESSION_SCHEMA_VERSION = 2 as const;

export type WorkspaceContext = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  color?: number;
  createdAt: number;
  updatedAt: number;
};

export type SessionSerializedTab = SerializedTab & {
  tabKey: string;
  workspaceScopeId: string;
};

export type SessionSnapshot = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  workspaceContexts: WorkspaceContext[];
  activeWorkspaceContextId: string | null;
  tabs: SessionSerializedTab[];
  activeTabKey: TabKey | null;
  viewSpaces: ViewSpace[];
  stripEntries: StripEntry[];
  activeStripItem: ActiveStripItem | null;
};

export type SessionEnvelope = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  ownerInstanceId: string;
  generation: number;
  savedAt: number;
  closedAt: number | null;
  snapshot: SessionSnapshot;
};

export type LegacySpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
};

export type LegacySpacesStore = {
  spaces: WorkspaceContext[];
  activeId: string | null;
  states: Map<string, LegacySpaceState>;
};

export type RuntimeSessionState = {
  workspaceContexts: WorkspaceContext[];
  activeWorkspaceContextId: string | null;
  tabs: Tab[];
  activeTabId: number;
  viewSpaces: ViewSpace[];
  stripEntries: StripEntry[];
  activeStripItem: ActiveStripItem | null;
};

type EnvelopeMeta = Omit<SessionEnvelope, "schemaVersion" | "snapshot">;

function safeWorkspaceEnv(value: unknown): WorkspaceEnv {
  if (!value || typeof value !== "object") return LOCAL_WORKSPACE;
  const env = value as Partial<WorkspaceEnv>;
  if (env.kind === "local") return LOCAL_WORKSPACE;
  if (env.kind === "wsl" && typeof env.distro === "string") {
    return { kind: "wsl", distro: env.distro };
  }
  if (
    env.kind === "ssh" &&
    typeof env.root === "string" &&
    env.connection &&
    typeof env.connection === "object"
  ) {
    return persistentWorkspaceEnv(env as WorkspaceEnv);
  }
  return LOCAL_WORKSPACE;
}

export function createSessionEnvelope(
  snapshot: SessionSnapshot,
  meta: EnvelopeMeta,
): SessionEnvelope {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    ...meta,
    snapshot: repairSessionSnapshot(snapshot),
  };
}

export function repairSessionEnvelope(
  value: unknown,
  requireClosed = false,
): SessionEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<SessionEnvelope>;
  if (
    envelope.schemaVersion !== SESSION_SCHEMA_VERSION ||
    typeof envelope.ownerInstanceId !== "string" ||
    !Number.isSafeInteger(envelope.generation) ||
    typeof envelope.savedAt !== "number" ||
    !(typeof envelope.closedAt === "number" || envelope.closedAt === null) ||
    (requireClosed && typeof envelope.closedAt !== "number") ||
    !envelope.snapshot ||
    typeof envelope.snapshot !== "object"
  ) {
    return null;
  }
  try {
    return {
      ...(envelope as SessionEnvelope),
      snapshot: repairSessionSnapshot(envelope.snapshot as SessionSnapshot),
    };
  } catch {
    return null;
  }
}

export function selectRestorableSession(
  lastCleanSession: unknown,
  _workingCheckpoint: unknown,
): SessionEnvelope | null {
  return repairSessionEnvelope(lastCleanSession, true);
}

function uniqueTabIdentity(
  tab: SerializedTab,
  contextId: string,
  seen: Set<string>,
  fallbackTabKey?: TabKey,
): SessionSerializedTab {
  let tabKey = isTabKey(tab.tabKey)
    ? asTabKey(tab.tabKey)
    : (fallbackTabKey ?? resolveTabKey(tab.tabKey));
  while (seen.has(tabKey)) tabKey = createTabKey();
  seen.add(tabKey);
  const persistedTab =
    tab.kind === "terminal" && tab.workspaceEnv
      ? { ...tab, workspaceEnv: safeWorkspaceEnv(tab.workspaceEnv) }
      : tab;
  return {
    ...persistedTab,
    tabKey,
    workspaceScopeId:
      typeof tab.workspaceScopeId === "string" &&
      tab.workspaceScopeId.length > 0
        ? tab.workspaceScopeId
        : asWorkspaceScopeId(contextId),
  };
}

function validSerializedNode(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): value is SerializedNode {
  if (
    !value ||
    typeof value !== "object" ||
    depth > 64 ||
    ancestors.has(value)
  ) {
    return false;
  }
  const node = value as Record<string, unknown>;
  if (node.kind === "leaf") {
    return node.cwd === undefined || typeof node.cwd === "string";
  }
  if (
    node.kind !== "split" ||
    (node.dir !== "row" && node.dir !== "col") ||
    !Array.isArray(node.children) ||
    node.children.length === 0
  ) {
    return false;
  }
  const next = new Set(ancestors);
  next.add(value);
  return node.children.every((child) =>
    validSerializedNode(child, next, depth + 1),
  );
}

function validSerializedTab(value: unknown): value is SerializedTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  if (tab.kind === "terminal") return validSerializedNode(tab.tree);
  if (tab.kind === "editor" || tab.kind === "markdown") {
    return typeof tab.path === "string" && tab.path.length > 0;
  }
  return tab.kind === "preview" && typeof tab.url === "string";
}

function selectedLegacyIndices(count: number, activeIndex: number): number[] {
  if (count <= 4) return Array.from({ length: count }, (_, index) => index);
  const active = Math.min(Math.max(activeIndex, 0), count - 1);
  return Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => Math.abs(a - active) - Math.abs(b - active) || a - b)
    .slice(0, 4)
    .sort((a, b) => a - b);
}

function slot(spaceId: string, index: number, memberTabKey: TabKey | null) {
  return {
    kind: "slot" as const,
    id: asSlotId(`slot-${spaceId}-${index + 1}`),
    memberTabKey,
  };
}

function legacyLayout(spaceId: string, members: TabKey[]): SpaceLayoutNode {
  const slots = Array.from(
    { length: Math.max(1, members.length) },
    (_, index) => slot(spaceId, index, members[index] ?? null),
  );
  if (slots.length === 1) return slots[0];
  if (slots.length === 2) {
    return {
      kind: "split",
      id: `split-${spaceId}-root`,
      direction: "row",
      ratio: 0.5,
      first: slots[0],
      second: slots[1],
    };
  }
  if (slots.length === 3) {
    return {
      kind: "split",
      id: `split-${spaceId}-root`,
      direction: "row",
      ratio: 0.5,
      first: slots[0],
      second: {
        kind: "split",
        id: `split-${spaceId}-second`,
        direction: "column",
        ratio: 0.5,
        first: slots[1],
        second: slots[2],
      },
    };
  }
  return {
    kind: "split",
    id: `split-${spaceId}-root`,
    direction: "row",
    ratio: 0.5,
    first: {
      kind: "split",
      id: `split-${spaceId}-first`,
      direction: "column",
      ratio: 0.5,
      first: slots[0],
      second: slots[1],
    },
    second: {
      kind: "split",
      id: `split-${spaceId}-second`,
      direction: "column",
      ratio: 0.5,
      first: slots[2],
      second: slots[3],
    },
  };
}

export function migrateLegacySpaces(
  legacy: LegacySpacesStore,
): SessionSnapshot {
  const seenTabKeys = new Set<string>();
  const tabs: SessionSerializedTab[] = [];
  const viewSpaces: ViewSpace[] = [];
  const stripEntries: StripEntry[] = [];
  let activeTabKey: TabKey | null = null;

  for (const context of legacy.spaces) {
    const state = legacy.states.get(context.id);
    const contextTabs = (state?.tabs ?? []).map((tab, index) => {
      const normalized = uniqueTabIdentity(
        tab,
        context.id,
        seenTabKeys,
        asTabKey(`tab-legacy-${encodeURIComponent(context.id)}-${index}`),
      );
      tabs.push(normalized);
      return normalized;
    });
    const selected = selectedLegacyIndices(
      contextTabs.length,
      state?.activeTabIndex ?? 0,
    );
    const selectedKeys = selected.map((index) =>
      asTabKey(contextTabs[index].tabKey),
    );
    const selectedSet = new Set(selectedKeys);
    const layout = legacyLayout(context.id, selectedKeys);
    const viewSpaceId = asViewSpaceId(`view-${context.id}`);
    const focusedKey = contextTabs[state?.activeTabIndex ?? 0]?.tabKey;
    const focusedSlot = collectLayoutSlots(layout).find(
      (candidate) => candidate.memberTabKey === focusedKey,
    );
    viewSpaces.push({
      id: viewSpaceId,
      name: context.name,
      ...(context.color !== undefined && { color: context.color }),
      presentation: "expanded",
      memberOrder: selectedKeys,
      layout,
      focusedSlotId:
        focusedSlot?.id ?? collectLayoutSlots(layout)[0]?.id ?? null,
    });
    stripEntries.push({ kind: "space", spaceId: viewSpaceId });
    for (const tab of contextTabs) {
      const tabKey = asTabKey(tab.tabKey);
      if (!selectedSet.has(tabKey)) {
        stripEntries.push({ kind: "standalone", tabKey });
      }
    }
    if (context.id === legacy.activeId) {
      activeTabKey = focusedKey ? asTabKey(focusedKey) : null;
    }
  }

  if (!activeTabKey && tabs[0]) activeTabKey = asTabKey(tabs[0].tabKey);
  return repairSessionSnapshot({
    schemaVersion: SESSION_SCHEMA_VERSION,
    workspaceContexts: legacy.spaces.map((space) => ({ ...space })),
    activeWorkspaceContextId:
      legacy.activeId &&
      legacy.spaces.some((space) => space.id === legacy.activeId)
        ? legacy.activeId
        : (legacy.spaces[0]?.id ?? null),
    tabs,
    activeTabKey,
    viewSpaces,
    stripEntries,
    activeStripItem: activeTabKey
      ? { kind: "tab", tabKey: activeTabKey }
      : null,
  });
}

export function snapshotFromRuntime(
  state: RuntimeSessionState,
): SessionSnapshot {
  const serializableTabs = state.tabs.filter(isSerializableTab);
  const serialized = serializeTabs(serializableTabs).map((tab, index) => ({
    ...tab,
    tabKey: serializableTabs[index].tabKey,
    workspaceScopeId: serializableTabs[index].workspaceScopeId,
  }));
  const active = serializableTabs.find((tab) => tab.id === state.activeTabId);
  return repairSessionSnapshot({
    schemaVersion: SESSION_SCHEMA_VERSION,
    workspaceContexts: state.workspaceContexts.map((context) => ({
      ...context,
      env: persistentWorkspaceEnv(context.env),
    })),
    activeWorkspaceContextId: state.activeWorkspaceContextId,
    tabs: serialized,
    activeTabKey: active?.tabKey ?? null,
    viewSpaces: state.viewSpaces,
    stripEntries: state.stripEntries,
    activeStripItem: state.activeStripItem,
  });
}

type RepairLayoutState = {
  live: ReadonlySet<TabKey>;
  assigned: Set<TabKey>;
  objects: Set<object>;
  ids: Set<string>;
  slots: number;
  generated: number;
};

function generatedSlot(state: RepairLayoutState): SpaceLayoutNode {
  state.generated += 1;
  state.slots += 1;
  return {
    kind: "slot",
    id: asSlotId(`slot-repaired-${state.generated}`),
    memberTabKey: null,
  };
}

function repairLayoutNode(
  value: unknown,
  state: RepairLayoutState,
): SpaceLayoutNode | null {
  if (state.slots >= 4 || typeof value !== "object" || value === null)
    return null;
  if (state.objects.has(value)) return null;
  state.objects.add(value);
  const node = value as Record<string, unknown>;
  let id =
    typeof node.id === "string" && node.id
      ? node.id
      : `layout-repaired-${++state.generated}`;
  if (state.ids.has(id)) id = `${id}-${++state.generated}`;
  state.ids.add(id);
  if (node.kind === "slot") {
    state.slots += 1;
    const rawMember =
      typeof node.memberTabKey === "string"
        ? asTabKey(node.memberTabKey)
        : null;
    const memberTabKey =
      rawMember && state.live.has(rawMember) && !state.assigned.has(rawMember)
        ? rawMember
        : null;
    if (memberTabKey) state.assigned.add(memberTabKey);
    return { kind: "slot", id: asSlotId(id), memberTabKey };
  }
  if (node.kind !== "split") return null;
  const first = repairLayoutNode(node.first, state);
  const second = repairLayoutNode(node.second, state);
  if (!first) return second;
  if (!second) return first;
  return {
    kind: "split",
    id,
    direction: node.direction === "column" ? "column" : "row",
    ratio:
      typeof node.ratio === "number" &&
      Number.isFinite(node.ratio) &&
      node.ratio > 0 &&
      node.ratio < 1
        ? node.ratio
        : 0.5,
    first,
    second,
  };
}

export function repairSessionSnapshot(input: SessionSnapshot): SessionSnapshot {
  const contexts: WorkspaceContext[] = [];
  const contextIds = new Set<string>();
  for (const context of Array.isArray(input.workspaceContexts)
    ? input.workspaceContexts
    : []) {
    if (
      !context ||
      typeof context.id !== "string" ||
      contextIds.has(context.id)
    )
      continue;
    contextIds.add(context.id);
    contexts.push({
      id: context.id,
      name: typeof context.name === "string" ? context.name : context.id,
      root: typeof context.root === "string" ? context.root : null,
      env: safeWorkspaceEnv(context.env),
      ...(typeof context.color === "number" && Number.isInteger(context.color)
        ? { color: context.color }
        : {}),
      createdAt:
        typeof context.createdAt === "number" &&
        Number.isFinite(context.createdAt)
          ? context.createdAt
          : 0,
      updatedAt:
        typeof context.updatedAt === "number" &&
        Number.isFinite(context.updatedAt)
          ? context.updatedAt
          : 0,
    });
  }
  const seenTabKeys = new Set<string>();
  const tabs: SessionSerializedTab[] = [];
  for (const value of Array.isArray(input.tabs) ? input.tabs : []) {
    if (!validSerializedTab(value)) continue;
    try {
      tabs.push(
        uniqueTabIdentity(
          value,
          typeof value.workspaceScopeId === "string"
            ? value.workspaceScopeId
            : (contexts[0]?.id ?? "default"),
          seenTabKeys,
        ),
      );
    } catch {}
  }
  for (const tab of tabs) {
    if (contextIds.has(tab.workspaceScopeId)) continue;
    contextIds.add(tab.workspaceScopeId);
    contexts.push({
      id: tab.workspaceScopeId,
      name: tab.workspaceScopeId,
      root: null,
      env: LOCAL_WORKSPACE,
      createdAt: 0,
      updatedAt: 0,
    });
  }
  const live = new Set(tabs.map((tab) => asTabKey(tab.tabKey)));
  const assigned = new Set<TabKey>();
  const viewSpaces: ViewSpace[] = [];
  const viewIds = new Set<string>();
  for (const value of Array.isArray(input.viewSpaces) ? input.viewSpaces : []) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.id !== "string" ||
      viewIds.has(value.id)
    )
      continue;
    const state: RepairLayoutState = {
      live,
      assigned,
      objects: new Set(),
      ids: new Set(),
      slots: 0,
      generated: 0,
    };
    const layout =
      repairLayoutNode(value.layout, state) ?? generatedSlot(state);
    const slots = collectLayoutSlots(layout);
    const layoutMembers = slots.flatMap((candidate) =>
      candidate.memberTabKey ? [candidate.memberTabKey] : [],
    );
    const orderSeen = new Set<TabKey>();
    const ordered = Array.isArray(value.memberOrder)
      ? value.memberOrder.filter((member): member is TabKey => {
          if (typeof member !== "string") return false;
          const key = asTabKey(member);
          if (!layoutMembers.includes(key) || orderSeen.has(key)) return false;
          orderSeen.add(key);
          return true;
        })
      : [];
    for (const member of layoutMembers) {
      if (!ordered.includes(member)) ordered.push(member);
    }
    const requestedFocus =
      typeof value.focusedSlotId === "string"
        ? asSlotId(value.focusedSlotId)
        : null;
    const focusedSlotId = slots.some(
      (candidate) => candidate.id === requestedFocus,
    )
      ? requestedFocus
      : (slots.find((candidate) => candidate.memberTabKey)?.id ??
        slots[0]?.id ??
        null);
    viewIds.add(value.id);
    viewSpaces.push({
      id: asViewSpaceId(value.id),
      name: typeof value.name === "string" ? value.name : "Space",
      ...(typeof value.color === "number" && Number.isInteger(value.color)
        ? { color: value.color }
        : {}),
      ...(value.deleted === true ? { deleted: true } : {}),
      presentation:
        value.presentation === "composite" ? "composite" : "expanded",
      memberOrder: ordered,
      layout,
      focusedSlotId,
    });
  }

  const stripEntries: StripEntry[] = [];
  const representedTabs = new Set<TabKey>();
  const representedSpaces = new Set<string>();
  for (const entry of Array.isArray(input.stripEntries)
    ? input.stripEntries
    : []) {
    if (!entry || typeof entry !== "object") continue;
    if (
      entry.kind === "space" &&
      viewIds.has(entry.spaceId) &&
      !viewSpaces.find((space) => space.id === entry.spaceId)?.deleted &&
      !representedSpaces.has(entry.spaceId)
    ) {
      representedSpaces.add(entry.spaceId);
      stripEntries.push({
        kind: "space",
        spaceId: asViewSpaceId(entry.spaceId),
      });
    } else if (
      entry.kind === "standalone" &&
      live.has(entry.tabKey) &&
      !assigned.has(entry.tabKey) &&
      !representedTabs.has(entry.tabKey)
    ) {
      representedTabs.add(entry.tabKey);
      stripEntries.push({ kind: "standalone", tabKey: entry.tabKey });
    }
  }
  for (const space of viewSpaces) {
    if (!space.deleted && !representedSpaces.has(space.id))
      stripEntries.push({ kind: "space", spaceId: space.id });
  }
  for (const tab of tabs) {
    const tabKey = asTabKey(tab.tabKey);
    if (!assigned.has(tabKey) && !representedTabs.has(tabKey)) {
      stripEntries.push({ kind: "standalone", tabKey });
      representedTabs.add(tabKey);
    }
  }

  const requestedActive =
    input.activeTabKey && live.has(input.activeTabKey)
      ? input.activeTabKey
      : tabs[0]
        ? asTabKey(tabs[0].tabKey)
        : null;
  let activeStripItem: ActiveStripItem | null = requestedActive
    ? { kind: "tab", tabKey: requestedActive }
    : null;
  if (requestedActive) {
    const owner = viewSpaces.find((space) =>
      space.memberOrder.includes(requestedActive),
    );
    if (owner?.presentation === "composite") {
      activeStripItem = {
        kind: "space",
        spaceId: owner.id,
        focusedSlotId:
          collectLayoutSlots(owner.layout).find(
            (candidate) => candidate.memberTabKey === requestedActive,
          )?.id ?? owner.focusedSlotId,
      };
    }
  }
  const activeTabContext = requestedActive
    ? tabs.find((tab) => tab.tabKey === requestedActive)?.workspaceScopeId
    : null;

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    workspaceContexts: contexts,
    activeWorkspaceContextId:
      activeTabContext && contextIds.has(activeTabContext)
        ? activeTabContext
        : input.activeWorkspaceContextId &&
            contextIds.has(input.activeWorkspaceContextId)
          ? input.activeWorkspaceContextId
          : (contexts[0]?.id ?? null),
    tabs,
    activeTabKey: requestedActive,
    viewSpaces,
    stripEntries,
    activeStripItem,
  };
}
