import { convertFileSrc } from "@tauri-apps/api/core";

const OPEN_KEY = "monocode.sidebarOpen";
const PROJECT_RAIL_OPEN_KEY = "monocode.projectRailOpen";
const SIDEBAR_TAB_ORDER_KEY = "monocode.sidebarTabOrder";
const PROJECT_RAIL_WIDTH_KEY = "monocode.projectRailWidth";
const SIDEBAR_LAYOUT_KEY = "monocode.sidebarLayout";
const TRANSCRIPT_LAYOUT_KEY = "monocode.transcriptLayout";
const TRANSCRIPT_ZEN_KEY = "monocode.transcriptZen";
const TRANSCRIPT_ANCHOR_KEY = "monocode.transcriptAnchor";
const CHAT_BACKGROUND_PATH_KEY = "monocode.chatBackgroundPath";
const CHAT_BACKGROUND_OPACITY_KEY = "monocode.chatBackgroundOpacity";
const CHAT_BACKGROUND_SCOPE_KEY = "monocode.chatBackgroundScope";
let chatBackgroundRevision = Date.now();

export type ColorScheme = "dark" | "light";
export type SidebarLayout = "classic" | "deck";
export type TranscriptLayout = "full" | "chat";
export type ChatBackgroundScope = "empty" | "all";

/** Fired on `window` whenever the sidebar layout flips (detail: SidebarLayout). */
export const LAYOUT_CHANGE_EVENT = "monocode:layoutchange";

export const SIDEBAR_LAYOUT_DEFAULT: SidebarLayout = "deck";

export const TRANSCRIPT_LAYOUT_DEFAULT: TranscriptLayout = "full";

export const TRANSCRIPT_ZEN_DEFAULT = true;

export const TRANSCRIPT_ANCHOR_DEFAULT = true;

/** Fired on `window` whenever zen mode flips (detail: boolean). */
export const TRANSCRIPT_ZEN_CHANGE_EVENT = "monocode:transcriptzenchange";

/** Fired on `window` whenever prompt-to-top anchoring flips (detail: boolean). */
export const TRANSCRIPT_ANCHOR_CHANGE_EVENT = "monocode:transcriptanchorchange";

/** Fired on `window` whenever the transcript layout flips (detail: TranscriptLayout). */
export const TRANSCRIPT_LAYOUT_CHANGE_EVENT = "monocode:transcriptlayoutchange";

export type SidebarTabId = "files" | "sessions" | "changes" | "inbox";

const DEFAULT_SIDEBAR_TAB_ORDER: SidebarTabId[] = [
  "sessions",
  "inbox",
  "files",
  "changes",
];

export const PROJECT_RAIL_WIDTH_MIN = 180;
export const PROJECT_RAIL_WIDTH_MAX = 360;
export const PROJECT_RAIL_WIDTH_DEFAULT = 200;

export const CHAT_BACKGROUND_OPACITY_MIN = 0.05;
export const CHAT_BACKGROUND_OPACITY_MAX = 0.65;
export const CHAT_BACKGROUND_OPACITY_DEFAULT = 0.24;
export const CHAT_BACKGROUND_SCOPE_DEFAULT: ChatBackgroundScope = "all";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // private mode / quota
  }
}

function readFlag(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return raw === "1" || raw === "true";
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
}

/** The harness has no color-scheme preference of its own: it reads whichever
 * mode Voktty's own ThemeProvider resolved (`.dark`/`.light` on
 * `<html>`, see `applyTheme.ts`), so its embedded editor/terminal always
 * match the app's active theme instead of drifting independently. */
export function isLightScheme(): boolean {
  return document.documentElement.classList.contains("light");
}

export function loadChatBackgroundPath(): string | null {
  try {
    return localStorage.getItem(CHAT_BACKGROUND_PATH_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function saveChatBackgroundPath(value: string | null) {
  try {
    if (value) localStorage.setItem(CHAT_BACKGROUND_PATH_KEY, value);
    else localStorage.removeItem(CHAT_BACKGROUND_PATH_KEY);
  } catch {
    // private mode / quota
  }
}

export function applyChatBackground(path: string | null) {
  const root = document.documentElement;
  root.classList.toggle("has-chat-background", !!path);
  if (!path) {
    root.style.removeProperty("--chat-background-image");
    return null;
  }
  chatBackgroundRevision += 1;
  const src = chatBackgroundSrc(path);
  root.style.setProperty(
    "--chat-background-image",
    `url(${JSON.stringify(src)})`,
  );
  return path;
}

export function chatBackgroundSrc(path: string | null): string | null {
  return path ? `${convertFileSrc(path)}?v=${chatBackgroundRevision}` : null;
}

export function loadChatBackgroundOpacity(): number {
  return clamp(
    readNumber(CHAT_BACKGROUND_OPACITY_KEY) ?? CHAT_BACKGROUND_OPACITY_DEFAULT,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
}

export function saveChatBackgroundOpacity(value: number) {
  writeNumber(
    CHAT_BACKGROUND_OPACITY_KEY,
    clamp(value, CHAT_BACKGROUND_OPACITY_MIN, CHAT_BACKGROUND_OPACITY_MAX),
  );
}

export function applyChatBackgroundOpacity(value: number) {
  const next = clamp(
    value,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
  document.documentElement.style.setProperty(
    "--chat-background-opacity",
    String(next),
  );
  return next;
}

function isChatBackgroundScope(value: unknown): value is ChatBackgroundScope {
  return value === "empty" || value === "all";
}

export function loadChatBackgroundScope(): ChatBackgroundScope {
  try {
    const raw = localStorage.getItem(CHAT_BACKGROUND_SCOPE_KEY);
    return isChatBackgroundScope(raw) ? raw : CHAT_BACKGROUND_SCOPE_DEFAULT;
  } catch {
    return CHAT_BACKGROUND_SCOPE_DEFAULT;
  }
}

export function saveChatBackgroundScope(value: ChatBackgroundScope) {
  try {
    localStorage.setItem(CHAT_BACKGROUND_SCOPE_KEY, value);
  } catch {
    // private mode / quota
  }
}

export function applyChatBackgroundScope(value: ChatBackgroundScope) {
  document.documentElement.classList.toggle(
    "chat-background-empty-only",
    value === "empty",
  );
  return value;
}

function isSidebarTabId(value: unknown): value is SidebarTabId {
  return (
    value === "files" ||
    value === "sessions" ||
    value === "changes" ||
    value === "inbox"
  );
}

export function loadSidebarOpen(): boolean {
  return readFlag(OPEN_KEY) ?? true;
}

export function saveSidebarOpen(value: boolean) {
  writeFlag(OPEN_KEY, value);
}

export function loadProjectRailOpen(): boolean {
  return readFlag(PROJECT_RAIL_OPEN_KEY) ?? true;
}

export function saveProjectRailOpen(value: boolean) {
  writeFlag(PROJECT_RAIL_OPEN_KEY, value);
}

export function loadSidebarTabOrder(): SidebarTabId[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_TAB_ORDER_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const next = parsed.filter(isSidebarTabId);
    for (const id of DEFAULT_SIDEBAR_TAB_ORDER) {
      if (!next.includes(id)) next.push(id);
    }
    return next.length === DEFAULT_SIDEBAR_TAB_ORDER.length
      ? next
      : [...DEFAULT_SIDEBAR_TAB_ORDER];
  } catch {
    return [...DEFAULT_SIDEBAR_TAB_ORDER];
  }
}

export function saveSidebarTabOrder(order: SidebarTabId[]) {
  try {
    localStorage.setItem(SIDEBAR_TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailWidth(): number {
  return Math.round(
    clamp(
      readNumber(PROJECT_RAIL_WIDTH_KEY) ?? PROJECT_RAIL_WIDTH_DEFAULT,
      PROJECT_RAIL_WIDTH_MIN,
      PROJECT_RAIL_WIDTH_MAX,
    ),
  );
}

export function saveProjectRailWidth(value: number) {
  writeNumber(
    PROJECT_RAIL_WIDTH_KEY,
    Math.round(clamp(value, PROJECT_RAIL_WIDTH_MIN, PROJECT_RAIL_WIDTH_MAX)),
  );
}

function isSidebarLayout(value: unknown): value is SidebarLayout {
  return value === "classic" || value === "deck";
}

export function loadSidebarLayout(): SidebarLayout {
  try {
    const raw = localStorage.getItem(SIDEBAR_LAYOUT_KEY);
    if (raw === "classic") {
      try {
        localStorage.setItem(SIDEBAR_LAYOUT_KEY, "deck");
      } catch {}
      return "deck";
    }
    return isSidebarLayout(raw) ? raw : "deck";
  } catch {
    return "deck";
  }
}

export function saveSidebarLayout(value: SidebarLayout) {
  try {
    localStorage.setItem(SIDEBAR_LAYOUT_KEY, value);
  } catch {
    // private mode / quota
  }
  window.dispatchEvent(
    new CustomEvent<SidebarLayout>(LAYOUT_CHANGE_EVENT, { detail: value }),
  );
}

function isTranscriptLayout(value: unknown): value is TranscriptLayout {
  return value === "full" || value === "chat";
}

export function loadTranscriptLayout(): TranscriptLayout {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_LAYOUT_KEY);
    return isTranscriptLayout(raw) ? raw : TRANSCRIPT_LAYOUT_DEFAULT;
  } catch {
    return TRANSCRIPT_LAYOUT_DEFAULT;
  }
}

export function saveTranscriptLayout(value: TranscriptLayout) {
  const next = isTranscriptLayout(value) ? value : TRANSCRIPT_LAYOUT_DEFAULT;
  try {
    localStorage.setItem(TRANSCRIPT_LAYOUT_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TranscriptLayout>(TRANSCRIPT_LAYOUT_CHANGE_EVENT, {
      detail: next,
    }),
  );
}

export function loadTranscriptZen(): boolean {
  return readFlag(TRANSCRIPT_ZEN_KEY) ?? TRANSCRIPT_ZEN_DEFAULT;
}

export function saveTranscriptZen(value: boolean) {
  writeFlag(TRANSCRIPT_ZEN_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(TRANSCRIPT_ZEN_CHANGE_EVENT, { detail: value }),
  );
}

export function toggleTranscriptZen(): boolean {
  const next = !loadTranscriptZen();
  saveTranscriptZen(next);
  return next;
}

export function loadTranscriptAnchor(): boolean {
  return readFlag(TRANSCRIPT_ANCHOR_KEY) ?? TRANSCRIPT_ANCHOR_DEFAULT;
}

export function saveTranscriptAnchor(value: boolean) {
  writeFlag(TRANSCRIPT_ANCHOR_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(TRANSCRIPT_ANCHOR_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

const CHANGES_VIEW_KEY = "monocode.changesView";
export type ChangesView = "list" | "tree";
export const CHANGES_VIEW_DEFAULT: ChangesView = "list";

function isChangesView(value: unknown): value is ChangesView {
  return value === "list" || value === "tree";
}

export function loadChangesView(): ChangesView {
  try {
    const raw = localStorage.getItem(CHANGES_VIEW_KEY);
    return isChangesView(raw) ? raw : CHANGES_VIEW_DEFAULT;
  } catch {
    return CHANGES_VIEW_DEFAULT;
  }
}

export function saveChangesView(value: ChangesView) {
  try {
    localStorage.setItem(CHANGES_VIEW_KEY, value);
  } catch {
    // private mode / quota
  }
}
