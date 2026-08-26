import { LazyStore } from "@tauri-apps/plugin-store";
import { LEGACY_STORAGE_PATHS } from "./identity";

const STORE_MIGRATIONS = [
  ["voktty-ai-sessions.json", LEGACY_STORAGE_PATHS.sessions],
  ["voktty-ai-agents.json", LEGACY_STORAGE_PATHS.agents],
  ["voktty-ai-snippets.json", LEGACY_STORAGE_PATHS.snippets],
  ["voktty-ai-todos.json", LEGACY_STORAGE_PATHS.todos],
  ["voktty-extensions.json", LEGACY_STORAGE_PATHS.extensions],
  ["voktty-settings.json", LEGACY_STORAGE_PATHS.settings],
  ["voktty-spaces.json", LEGACY_STORAGE_PATHS.spaces],
  ["voktty-custom-themes.json", LEGACY_STORAGE_PATHS.themes],
] as const;

let migrationPromise: Promise<void> | null = null;

async function migrateStore(newPath: string, legacyPath: string): Promise<void> {
  const current = new LazyStore(newPath, { defaults: {}, autoSave: 200 });
  const currentEntries = await current.entries();
  if (currentEntries.length > 0) return;

  const legacy = new LazyStore(legacyPath, { defaults: {}, autoSave: 200 });
  const legacyEntries = await legacy.entries();
  if (legacyEntries.length === 0) return;

  for (const [key, value] of legacyEntries) await current.set(key, value);
  await current.save();
}

function migrateLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (!key.toLowerCase().includes("terax")) continue;
      const migratedKey = key.replace(/terax/gi, "voktty");
      if (window.localStorage.getItem(migratedKey) === null) {
        const value = window.localStorage.getItem(key);
        if (value !== null) window.localStorage.setItem(migratedKey, value);
      }
    }
  } catch {
    // A restricted webview must not prevent the application from starting.
  }
}

export function ensureStorageMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = Promise.all(
      STORE_MIGRATIONS.map(([newPath, legacyPath]) =>
        migrateStore(newPath, legacyPath),
      ),
    )
      .then(() => migrateLocalStorage())
      .catch(() => {
        // Persistence is best-effort during a brand migration.
      });
  }
  return migrationPromise;
}
