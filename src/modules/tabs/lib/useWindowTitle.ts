import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { findLeafCwd } from "@/modules/terminal/lib/panes";
import type { Tab } from "./useTabs";

const APP_NAME = "Voktty";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/** Label of the focused tab — for terminals, the active pane's folder. */
function tabLabel(tab: Tab | undefined): string {
  if (!tab) return "";
  if (tab.kind === "terminal") {
    const cwd = findLeafCwd(tab.paneTree, tab.activeLeafId) ?? tab.cwd;
    return cwd ? basename(cwd) : tab.title;
  }
  return tab.title;
}

/**
 * Drives the OS window title from the focused tab + project folder, the way
 * Spotify shows the current track instead of just the app name. Without this
 * the window keeps the build-time default ("Tauri App" on Linux).
 *
 * Format: `<project> — <tab>` (e.g. `voktty-ai — src`), collapsing to just the
 * project when the focused terminal sits at the project root. Falls back to the
 * app name when there's nothing to show.
 */
export function useWindowTitle(
  activeTab: Tab | undefined,
  explorerRoot: string | null,
  spaceName?: string | null,
): void {
  const project = explorerRoot ? basename(explorerRoot) : "";
  const label = tabLabel(activeTab);
  const focused =
    spaceName && label ? `${spaceName} · ${label}` : spaceName || label;

  useEffect(() => {
    let title: string;
    if (project && focused && focused !== project)
      title = `${project} — ${focused}`;
    else title = project || focused || APP_NAME;

    document.title = title;
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
  }, [focused, project]);
}
