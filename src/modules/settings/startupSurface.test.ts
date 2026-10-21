import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, translate } from "@/modules/i18n/resolve";
import { exportConfiguration, importConfiguration } from "./configExport";
import { usePreferencesStore } from "./preferences";
import {
  DEFAULT_PREFERENCES,
  isStartupSurface,
  loadPreferences,
  onPreferencesChange,
  setStartupSurface,
  writePreferencesBatch,
} from "./store";

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  save: vi.fn(),
  emit: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries = async () => [...mocks.values.entries()];
    set = async (key: string, value: unknown) => {
      mocks.values.set(key, value);
    };
    save = mocks.save;
    onChange = async () => () => {};
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: mocks.emit,
  listen: mocks.listen,
}));
vi.mock("@/lib/storageMigration", () => ({
  ensureStorageMigrated: async () => {},
}));

beforeEach(() => {
  mocks.values.clear();
  vi.clearAllMocks();
});

it("localizes startup controls in English and Spanish with English fallback", async () => {
  await Promise.all([loadLocale("es"), loadLocale("de")]);
  for (const suffix of [
    "startupSurfaceTitle",
    "startupSurfaceDesc",
    "startupHarness",
    "startupTerminal",
    "startupSurfaceSaveError",
  ]) {
    const key = `settings.general.window.${suffix}`;
    expect(translate("en", key)).not.toBe(key);
    expect(translate("es", key)).not.toBe(key);
    expect(translate("de", key)).toBe(translate("en", key));
  }
  expect(translate("es", "settings.general.window.startupSurfaceTitle")).toBe(
    "Superficie de inicio",
  );
});

describe("startup surface preference", () => {
  it("defaults all users including existing settings without the key to Harness", async () => {
    mocks.values.set("theme", "dark");
    expect(DEFAULT_PREFERENCES.startupSurface).toBe("harness");
    expect((await loadPreferences()).startupSurface).toBe("harness");
  });

  it.each([undefined, null, "", "ssh", 1, {}])(
    "normalizes invalid persisted values %j",
    async (value) => {
      mocks.values.set("startupSurface", value);
      expect(isStartupSurface(value)).toBe(false);
      expect((await loadPreferences()).startupSurface).toBe("harness");
    },
  );

  it.each(["harness", "terminal"] as const)(
    "roundtrips explicit %s through the setter",
    async (value) => {
      expect(isStartupSurface(value)).toBe(true);
      await setStartupSurface(value);
      expect((await loadPreferences()).startupSurface).toBe(value);
      expect(mocks.emit).toHaveBeenCalledWith("voktty://prefs-changed", {
        key: "startupSurface",
        value,
      });
      expect(mocks.save).toHaveBeenCalled();
    },
  );

  it("roundtrips configuration and keeps invalid imports normalized in live state", async () => {
    const config = exportConfiguration({ startupSurface: "terminal" });
    expect((await importConfiguration(JSON.stringify(config))).success).toBe(
      true,
    );
    expect(usePreferencesStore.getState().startupSurface).toBe("terminal");
    expect((await loadPreferences()).startupSurface).toBe("terminal");
    await importConfiguration({ startupSurface: "invalid" });
    expect(usePreferencesStore.getState().startupSurface).toBe("harness");
    expect((await loadPreferences()).startupSurface).toBe("harness");
  });

  it("validates batch imports and cross-window updates", async () => {
    await writePreferencesBatch({ startupSurface: "terminal" });
    expect((await loadPreferences()).startupSurface).toBe("terminal");
    await writePreferencesBatch({ startupSurface: "invalid" as "terminal" });
    expect((await loadPreferences()).startupSurface).toBe("harness");
    const cb = vi.fn();
    await onPreferencesChange(cb);
    const listener = mocks.listen.mock.calls[0][1];
    listener({ payload: { key: "startupSurface", value: "invalid" } });
    expect(cb).toHaveBeenLastCalledWith("startupSurface", "harness");
  });
});
