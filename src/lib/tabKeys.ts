/**
 * Workspace keybindings:
 *   New tab             cmd-t
 *   Close tab           cmd-w
 *   Split pane right    cmd-d
 *   Split pane down     shift-cmd-d
 *   Next tab            shift-cmd-}
 *   Previous tab        shift-cmd-{
 *   Back in tab history cmd-[
 *   Forward in history  cmd-]
 *   Activate tab 1–8    cmd-1 … cmd-8
 *   Last tab            cmd-9
 *   Cycle next tab      ctrl-tab
 *   Cycle previous tab  ctrl-shift-tab
 *   Focus pane          cmd-opt-arrows
 *   New terminal        cmd-`
 *   New terminal tab    shift-cmd-`
 *   Toggle terminal     cmd-j
 *   Previous session    shift-cmd-up
 *   Next session        shift-cmd-down
 *   Previous project    shift-cmd-left
 *   Next project        shift-cmd-right
 */

import type { FocusDir } from "./layout";

export type TabCommand =
  | "new"
  | "close"
  | "next"
  | "prev"
  | "back"
  | "forward"
  | "split-right"
  | "split-down"
  | "new-terminal"
  | "new-terminal-tab"
  | "toggle-terminal"
  | "prev-session"
  | "next-session"
  | "prev-project"
  | "next-project"
  | { activate: number }
  | { focus: FocusDir };

export function tabCommand(e: KeyboardEvent): TabCommand | null {
  if (e.isComposing) return null;

  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.altKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") return { focus: "left" };
    if (e.key === "ArrowRight") return { focus: "right" };
    if (e.key === "ArrowUp") return { focus: "up" };
    if (e.key === "ArrowDown") return { focus: "down" };
    return null;
  }

  if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
    return e.shiftKey ? "prev" : "next";
  }

  if (!mod || e.altKey) return null;

  if (e.key === "`" || e.code === "Backquote") {
    return e.shiftKey ? "new-terminal-tab" : "new-terminal";
  }

  const key = e.key.toLowerCase();

  if (e.shiftKey) {
    if (e.key === "]" || e.key === "}") return "next";
    if (e.key === "[" || e.key === "{") return "prev";
    if (e.key === "ArrowUp") return "prev-session";
    if (e.key === "ArrowDown") return "next-session";
    if (e.key === "ArrowLeft") return "prev-project";
    if (e.key === "ArrowRight") return "next-project";
    if (key === "d") return "split-down";
    return null;
  }

  if (key === "t") return "new";
  if (key === "w") return "close";
  if (key === "d") return "split-right";
  if (key === "j") return "toggle-terminal";
  if (e.key === "[" || e.code === "BracketLeft") return "back";
  if (e.key === "]" || e.code === "BracketRight") return "forward";
  if (key >= "1" && key <= "8") return { activate: Number(key) - 1 };
  if (key === "9") return { activate: -1 };
  return null;
}

export function adjacentItemId(
  ids: readonly string[],
  current: string | null,
  delta: number,
): string | null {
  if (ids.length === 0) return null;
  const index = current ? ids.indexOf(current) : -1;
  if (index < 0) return delta < 0 ? ids[ids.length - 1] : ids[0];
  const next = (index + (delta < 0 ? -1 : 1) + ids.length) % ids.length;
  return ids[next] ?? null;
}

export function shouldHandleListNavigation(input: {
  blockedTarget: boolean;
  surfaceOpen: boolean;
}): boolean {
  return !input.blockedTarget && !input.surfaceOpen;
}
