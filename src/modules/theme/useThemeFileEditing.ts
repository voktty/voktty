import { type RefObject, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { setThemeId as persistThemeId } from "@/modules/settings/store";
import type { Tab } from "@/modules/tabs";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  parseFileWritten,
  fileWrittenOnFilesystem,
} from "@/modules/workspace/fileWritten";
import { listCustomThemes, saveCustomTheme } from "./customThemes";
import {
  isThemeFilePath,
  onThemeEdit,
  parseThemeFile,
  starterTheme,
  themeFilePath,
  writeThemeFile,
} from "./themeFiles";

type Params = {
  tabsRef: RefObject<Tab[]>;
  openFileTab: (path: string) => void;
};

let pendingThemeReads = 0;

/**
 * A custom theme is materialized to a real file and edited in the code editor.
 * Saving it re-ingests into the runtime store + applies live; the edit request
 * channel opens (or creates) the theme file for editing.
 */
export function useThemeFileEditing({ tabsRef, openFileTab }: Params) {
  useEffect(() => {
    let active = true;
    let tail = Promise.resolve();
    const latest = new Map<string, object>();
    const unlistenPromise = getCurrentWebviewWindow()
      .listen<unknown>("fs:file-written", (event) => {
        if (!active) return;
        const written = parseFileWritten(event.payload);
        if (
          written?.source !== "editor" ||
          !fileWrittenOnFilesystem(written, written.path, LOCAL_WORKSPACE) ||
          !isThemeFilePath(written.path) ||
          pendingThemeReads >= 256
        )
          return;
        const receipt = {};
        latest.set(written.path, receipt);
        const current = () => active && latest.get(written.path) === receipt;
        pendingThemeReads++;
        tail = tail.then(async () => {
          try {
            if (!current()) return;
            const res = await invoke<{ kind: string; content?: string }>(
              "fs_read_file",
              { path: written.path, workspace: LOCAL_WORKSPACE },
            );
            if (
              !current() ||
              res.kind !== "text" ||
              typeof res.content !== "string"
            )
              return;
            const parsed = parseThemeFile(res.content);
            if (!parsed.ok || !current()) return;
            await saveCustomTheme(parsed.theme);
          } catch {
          } finally {
            pendingThemeReads--;
            if (latest.get(written.path) === receipt)
              latest.delete(written.path);
          }
        });
      })
      .catch(() => () => {});
    return () => {
      active = false;
      latest.clear();
      void unlistenPromise.then((un) => un()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    void onThemeEdit(async (req) => {
      const theme =
        req.action === "create"
          ? starterTheme()
          : (await listCustomThemes()).find((t) => t.id === req.id);
      if (!theme) return;
      if (req.action === "create") await saveCustomTheme(theme);
      const path = await themeFilePath(theme.id);
      const open = tabsRef.current.some(
        (t) => t.kind === "editor" && t.path === path,
      );
      if (!open) await writeThemeFile(theme);
      void persistThemeId(theme.id);
      openFileTab(path);
      void getCurrentWebviewWindow().setFocus();
    }).then((fn) => {
      if (alive) unsub = fn;
      else fn();
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [openFileTab, tabsRef]);
}
