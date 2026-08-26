import { ensureStorageMigrated } from "@/lib/storageMigration";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { PersistedEditorViewState } from "./editorViewState";

type StoredEditorViewState = PersistedEditorViewState & { updatedAt: number };

const STORE_PATH = "voktty-editor-view-state.json";
const ENTRY_PREFIX = "view:";
const MAX_ENTRIES = 500;
const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });
let mutation = Promise.resolve();
let entriesPromise: Promise<Map<string, StoredEditorViewState>> | null = null;

function entryKey(spaceId: string, path: string): string {
  const canonical = path.replace(/\\/g, "/");
  return `${ENTRY_PREFIX}${encodeURIComponent(spaceId)}:${encodeURIComponent(canonical)}`;
}

async function loadEntries(): Promise<Map<string, StoredEditorViewState>> {
  if (!entriesPromise) {
    entriesPromise = (async () => {
      await ensureStorageMigrated();
      return new Map(
        (await store.entries())
          .filter(([key]) => key.startsWith(ENTRY_PREFIX))
          .map(([key, value]) => [key, value as StoredEditorViewState]),
      );
    })().catch((error) => {
      entriesPromise = null;
      throw error;
    });
  }
  return entriesPromise;
}

export async function loadEditorViewState(
  spaceId: string,
  path: string,
): Promise<PersistedEditorViewState | null> {
  const entry = (await loadEntries()).get(entryKey(spaceId, path));
  if (!entry) return null;
  const { updatedAt: _updatedAt, ...state } = entry;
  return state;
}

export function saveEditorViewState(
  spaceId: string,
  path: string,
  state: PersistedEditorViewState,
): Promise<void> {
  mutation = mutation.catch(() => {}).then(async () => {
    const entries = await loadEntries();
    const key = entryKey(spaceId, path);
    const entry = { ...state, updatedAt: Date.now() };
    entries.set(key, entry);
    await store.set(key, entry);
    const oldest = [...entries.entries()].sort(
      (left, right) => left[1].updatedAt - right[1].updatedAt,
    );
    for (const [oldestKey] of oldest.slice(
      0,
      Math.max(0, oldest.length - MAX_ENTRIES),
    )) {
      entries.delete(oldestKey);
      await store.delete(oldestKey);
    }
  });
  return mutation.catch(() => {});
}
