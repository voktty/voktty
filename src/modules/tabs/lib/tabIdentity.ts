declare const tabKeyBrand: unique symbol;
declare const workspaceScopeIdBrand: unique symbol;

export type TabKey = string & { readonly [tabKeyBrand]: true };
export type WorkspaceScopeId = string & {
  readonly [workspaceScopeIdBrand]: true;
};

type IdSource = () => string;

function defaultIdSource(): string {
  return globalThis.crypto.randomUUID();
}

export function asTabKey(value: string): TabKey {
  return value as TabKey;
}

export function asWorkspaceScopeId(value: string): WorkspaceScopeId {
  return value as WorkspaceScopeId;
}

export function isTabKey(value: unknown): value is TabKey {
  return typeof value === "string" && /^tab-\S+$/.test(value);
}

export function createTabKey(source: IdSource = defaultIdSource): TabKey {
  return asTabKey(`tab-${source()}`);
}

export function resolveTabKey(
  persisted: unknown,
  source: IdSource = defaultIdSource,
): TabKey {
  return isTabKey(persisted) ? persisted : createTabKey(source);
}

export function workspaceScopeIdFromLegacySpace(
  spaceId: string,
): WorkspaceScopeId {
  return asWorkspaceScopeId(spaceId);
}

export function createTabIdentity(
  legacySpaceId: string,
  source: IdSource = defaultIdSource,
): { tabKey: TabKey; workspaceScopeId: WorkspaceScopeId } {
  return {
    tabKey: createTabKey(source),
    workspaceScopeId: workspaceScopeIdFromLegacySpace(legacySpaceId),
  };
}

export function duplicateTabKeys<T extends { tabKey: TabKey }>(
  tabs: readonly T[],
): TabKey[] {
  const seen = new Set<TabKey>();
  const duplicates = new Set<TabKey>();
  for (const tab of tabs) {
    if (seen.has(tab.tabKey)) duplicates.add(tab.tabKey);
    seen.add(tab.tabKey);
  }
  return [...duplicates];
}
