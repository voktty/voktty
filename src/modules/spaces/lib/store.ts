import { ensureStorageMigrated } from "@/lib/storageMigration";
import type { WorkspaceEnv } from "@/modules/workspace";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { SerializedTab } from "./serialize";
import {
  createSessionEnvelope,
  type LegacySpacesStore,
  migrateLegacySpaces,
  repairSessionEnvelope,
  type SessionEnvelope,
  type SessionSnapshot,
  selectRestorableSession,
} from "./sessionSnapshot";

export type SpaceMeta = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  /** Opt-in accent, index into SPACE_COLORS. Undefined = theme primary. */
  color?: number;
  createdAt: number;
  updatedAt: number;
};

export type SpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
};

const STORE_PATH = "voktty-spaces.json";
const KEY_SPACES = "spaces";
const KEY_ACTIVE = "activeId";
const STATE_PREFIX = "state:";
const KEY_WORKING_CHECKPOINT = "session:workingCheckpoint";
const KEY_LAST_CLEAN_SESSION = "session:lastCleanSession";
const KEY_LEGACY_BACKUP = "session:legacyBackup";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });

export type LoadedSpaces = {
  spaces: SpaceMeta[];
  activeId: string | null;
  states: Map<string, SpaceState>;
  session: SessionSnapshot | null;
  migratedLegacy: boolean;
};

type LegacyBackup = {
  spaces: SpaceMeta[];
  activeId: string | null;
  states: Record<string, SpaceState>;
};

let generationFloor = 0;
let writeChain = Promise.resolve();

function validEnvelope(value: unknown): SessionEnvelope | null {
  return repairSessionEnvelope(value);
}

function legacyFromEntries(entries: [string, unknown][]): LegacySpacesStore {
  let spaces: SpaceMeta[] = [];
  let activeId: string | null = null;
  const states = new Map<string, SpaceState>();
  for (const [key, value] of entries) {
    if (key === KEY_SPACES && Array.isArray(value))
      spaces = value as SpaceMeta[];
    else if (key === KEY_ACTIVE) activeId = (value as string | null) ?? null;
    else if (
      key.startsWith(STATE_PREFIX) &&
      value &&
      typeof value === "object"
    ) {
      states.set(key.slice(STATE_PREFIX.length), value as SpaceState);
    }
  }
  return { spaces, activeId, states };
}

function loadedFromSnapshot(
  session: SessionSnapshot,
  migratedLegacy: boolean,
): LoadedSpaces {
  const states = new Map<string, SpaceState>();
  for (const context of session.workspaceContexts) {
    const tabs = session.tabs.filter(
      (tab) => tab.workspaceScopeId === context.id,
    );
    const activeTabIndex = session.activeTabKey
      ? Math.max(
          0,
          tabs.findIndex((tab) => tab.tabKey === session.activeTabKey),
        )
      : 0;
    states.set(context.id, { tabs, activeTabIndex });
  }
  return {
    spaces: session.workspaceContexts,
    activeId: session.activeWorkspaceContextId,
    states,
    session,
    migratedLegacy,
  };
}

export async function loadAll(): Promise<LoadedSpaces> {
  await ensureStorageMigrated();
  const entries = await store.entries();
  const clean = selectRestorableSession(
    entries.find(([key]) => key === KEY_LAST_CLEAN_SESSION)?.[1],
    entries.find(([key]) => key === KEY_WORKING_CHECKPOINT)?.[1],
  );
  if (clean) {
    generationFloor = Math.max(generationFloor, clean.generation);
    return loadedFromSnapshot(clean.snapshot, false);
  }
  const legacy = legacyFromEntries(entries);
  if (legacy.spaces.length === 0) {
    return {
      spaces: [],
      activeId: null,
      states: new Map(),
      session: null,
      migratedLegacy: false,
    };
  }
  if (!entries.some(([key]) => key === KEY_LEGACY_BACKUP)) {
    const backup: LegacyBackup = {
      spaces: legacy.spaces,
      activeId: legacy.activeId,
      states: Object.fromEntries(legacy.states),
    };
    await store.set(KEY_LEGACY_BACKUP, backup);
    await store.save();
  }
  return loadedFromSnapshot(migrateLegacySpaces(legacy), true);
}

export function reserveSessionGeneration(): number {
  generationFloor += 1;
  return generationFloor;
}

function enqueueWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = writeChain.then(write, write);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function newestStoredGeneration(): Promise<number> {
  const [working, clean] = await Promise.all([
    store.get<unknown>(KEY_WORKING_CHECKPOINT),
    store.get<unknown>(KEY_LAST_CLEAN_SESSION),
  ]);
  return Math.max(
    validEnvelope(working)?.generation ?? 0,
    validEnvelope(clean)?.generation ?? 0,
  );
}

export function writeWorkingCheckpoint(
  snapshot: SessionSnapshot,
  input: {
    ownerInstanceId: string;
    generation: number;
    savedAt?: number;
  },
): Promise<SessionEnvelope | null> {
  return enqueueWrite(async () => {
    const newest = await newestStoredGeneration();
    if (input.generation <= newest) {
      generationFloor = Math.max(generationFloor, newest);
      return null;
    }
    const envelope = createSessionEnvelope(snapshot, {
      ownerInstanceId: input.ownerInstanceId,
      generation: input.generation,
      savedAt: input.savedAt ?? Date.now(),
      closedAt: null,
    });
    await store.set(KEY_WORKING_CHECKPOINT, envelope);
    await store.save();
    generationFloor = Math.max(generationFloor, envelope.generation);
    if (await store.has(KEY_LEGACY_BACKUP)) {
      await store.delete(KEY_LEGACY_BACKUP);
      await store.save();
    }
    return envelope;
  });
}

export function promoteLastCleanSession(
  snapshot: SessionSnapshot,
  input: {
    ownerInstanceId: string;
    generation: number;
    savedAt?: number;
    closedAt?: number;
  },
): Promise<SessionEnvelope | null> {
  return enqueueWrite(async () => {
    const newest = await newestStoredGeneration();
    if (input.generation <= newest) {
      generationFloor = Math.max(generationFloor, newest);
      return null;
    }
    const closedAt = input.closedAt ?? Date.now();
    const envelope = createSessionEnvelope(snapshot, {
      ownerInstanceId: input.ownerInstanceId,
      generation: input.generation,
      savedAt: input.savedAt ?? closedAt,
      closedAt,
    });
    await store.set(KEY_WORKING_CHECKPOINT, envelope);
    await store.set(KEY_LAST_CLEAN_SESSION, envelope);
    await store.save();
    generationFloor = Math.max(generationFloor, envelope.generation);
    if (await store.has(KEY_LEGACY_BACKUP)) {
      await store.delete(KEY_LEGACY_BACKUP);
      await store.save();
    }
    return envelope;
  });
}

export function newSpaceId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
