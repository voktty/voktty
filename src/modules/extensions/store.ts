import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { loadExtension, unloadExtension } from "./lib/extensionLoader";
import type { ActiveExtension, ExtensionInfo } from "./types";
import { ensureStorageMigrated } from "@/lib/storageMigration";

const STORE_PATH = "voktty-extensions.json";
const KEY_ENABLED = "enabled_extensions";

const store = new LazyStore(STORE_PATH, {
  defaults: {},
  autoSave: 200,
});

interface ExtensionState {
  extensions: ExtensionInfo[];
  activeExtensions: Record<string, ActiveExtension>;
  enabledIds: string[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  init: () => Promise<void>;
  scanExtensions: () => Promise<void>;
  enableExtension: (id: string) => Promise<void>;
  disableExtension: (id: string) => Promise<void>;
  reloadExtension: (id: string) => Promise<void>;
  deleteExtension: (id: string) => Promise<void>;
  openFolder: () => Promise<void>;
}

export const useExtensionStore = create<ExtensionState>((set, get) => ({
  extensions: [],
  activeExtensions: {},
  enabledIds: [],
  loading: false,
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    // Mark immediately so no second call is queued even if the deferred init
    // hasn't finished yet. The loading flag drives the UI spinner.
    set({ loading: true, initialized: true });

    // Defer all async I/O to the next event-loop tick so the first React
    // render is never blocked — extensions load in the background.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    try {
      await ensureStorageMigrated();
      let savedEnabled: string[] = [];
      try {
        savedEnabled = (await store.get<string[]>(KEY_ENABLED)) ?? [];
      } catch {
        savedEnabled = [];
      }

      set({ enabledIds: savedEnabled });
      await get().scanExtensions();

      // Auto-activate enabled extensions
      const exts = get().extensions;
      for (const ext of exts) {
        if (savedEnabled.includes(ext.id)) {
          try {
            const active = await loadExtension(ext);
            set((state) => ({
              activeExtensions: {
                ...state.activeExtensions,
                [ext.id]: active,
              },
            }));
          } catch {
            // ignore individual activation errors
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
    } finally {
      set({ loading: false });
    }
  },

  scanExtensions: async () => {
    try {
      const list = await invoke<ExtensionInfo[]>("extensions_list");
      set({ extensions: list, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
    }
  },

  enableExtension: async (id: string) => {
    const ext = get().extensions.find((e) => e.id === id);
    if (!ext) return;

    const currentEnabled = Array.from(new Set([...get().enabledIds, id]));
    set({ enabledIds: currentEnabled });
    try {
      await store.set(KEY_ENABLED, currentEnabled);
      await store.save();
    } catch {
      // ignore store save errors
    }

    const active = await loadExtension(ext);
    set((state) => ({
      activeExtensions: {
        ...state.activeExtensions,
        [id]: active,
      },
    }));
  },

  disableExtension: async (id: string) => {
    const active = get().activeExtensions[id];
    if (active) {
      await unloadExtension(active);
    }

    const currentEnabled = get().enabledIds.filter((e) => e !== id);
    set((state) => {
      const newActive = { ...state.activeExtensions };
      delete newActive[id];
      return {
        enabledIds: currentEnabled,
        activeExtensions: newActive,
      };
    });

    try {
      await store.set(KEY_ENABLED, currentEnabled);
      await store.save();
    } catch {
      // ignore store save errors
    }
  },

  reloadExtension: async (id: string) => {
    const ext = get().extensions.find((e) => e.id === id);
    if (!ext) return;

    const active = get().activeExtensions[id];
    if (active) {
      await unloadExtension(active);
    }

    const newActive = await loadExtension(ext);
    set((state) => ({
      activeExtensions: {
        ...state.activeExtensions,
        [id]: newActive,
      },
    }));
  },

  deleteExtension: async (id: string) => {
    const ext = get().extensions.find((e) => e.id === id);
    if (!ext) return;

    await get().disableExtension(id);
    await invoke("extensions_delete", { folderName: ext.folder_name });
    await get().scanExtensions();
  },

  openFolder: async () => {
    await invoke("extensions_open_dir");
  },
}));
