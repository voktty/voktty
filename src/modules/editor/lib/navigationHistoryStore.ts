import { ensureStorageMigrated } from "@/lib/storageMigration";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  hydrateNavigationHistory,
  type NavigationHistory,
} from "./navigationHistory";

const store = new LazyStore("voktty-editor-navigation.json", {
  defaults: {},
  autoSave: 500,
});
const HISTORY_KEY = "history";

export async function loadNavigationHistory(): Promise<NavigationHistory> {
  await ensureStorageMigrated();
  return hydrateNavigationHistory(await store.get<unknown>(HISTORY_KEY));
}

export async function saveNavigationHistory(
  state: NavigationHistory,
): Promise<void> {
  await ensureStorageMigrated();
  await store.set(HISTORY_KEY, {
    entries: state.entries.slice(-state.limit),
    index: state.index,
  });
}
