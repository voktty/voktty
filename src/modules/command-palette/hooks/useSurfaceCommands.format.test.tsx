// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSurfaceCommands } from "@/modules/command-palette/hooks/useSurfaceCommands";
import {
  captureSurfaceCommand,
  type SurfaceCommand,
} from "@/modules/command-palette/lib/surfaceCommand";
import {
  publishActiveSurface,
  useActiveSurfaceStore,
} from "@/modules/surfaces/lib/activeSurfaceStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { loadLocale } from "@/modules/i18n";

let root: Root;
let items: SurfaceCommand[];
const run = vi.fn();
const original = [{ id: "editor.formatDocument", run }];
function Reader() {
  items = useSurfaceCommands(original, true);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  run.mockClear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  publishActiveSurface(null);
  usePreferencesStore.setState({ language: "en" });
  vi.unstubAllGlobals();
});
it.each([
  ["en", "This action is unavailable for this filesystem."],
  ["es", "Esta acción no está disponible para este sistema de archivos."],
] as const)(
  "renders the unavailable formatting reason in %s and prevents forced execution",
  async (language, reason) => {
    await loadLocale(language);
    usePreferencesStore.setState({ language });
    publishActiveSurface({
      kind: "editor",
      ownerId: 1,
      folder: "remote://machine/project",
    });
    await act(async () => root.render(<Reader />));
    expect(items[0].disabledReason).toBe(reason);
    expect(
      captureSurfaceCommand(
        items[0],
        () => useActiveSurfaceStore.getState().surface,
      ),
    ).toBeNull();
    expect(run).not.toHaveBeenCalled();
  },
);
it("refreshes formatting availability across a filesystem round trip without mutating its catalog", async () => {
  usePreferencesStore.setState({ language: "en" });
  publishActiveSurface({ kind: "editor", ownerId: 1, folder: "/project" });
  await act(async () => root.render(<Reader />));
  const local = captureSurfaceCommand(
    items[0],
    () => useActiveSurfaceStore.getState().surface,
  );
  await act(async () =>
    publishActiveSurface({
      kind: "editor",
      ownerId: 1,
      folder: "remote://machine/project",
    }),
  );
  expect(items[0].disabledReason).toBeTruthy();
  await act(async () =>
    publishActiveSurface({ kind: "editor", ownerId: 1, folder: "/project" }),
  );
  expect(items[0].disabledReason).toBeUndefined();
  expect(items[0]).toBe(original[0]);
  local?.();
  expect(run).not.toHaveBeenCalled();
  captureSurfaceCommand(
    items[0],
    () => useActiveSurfaceStore.getState().surface,
  )?.();
  expect(run).toHaveBeenCalledOnce();
});
