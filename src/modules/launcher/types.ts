import type { TerminalIcon } from "@hugeicons/core-free-icons";
import type { SurfaceKind } from "@/modules/surfaces/lib/activeSurface";

export type LauncherIcon = typeof TerminalIcon;

/** Stable group ids; the visible label comes from `launcher.groups.<id>`. */
export const LAUNCHER_GROUPS = [
  "terminals",
  "connections",
  "development",
  "git",
  "ai",
  "system",
  "extras",
] as const;

export type LauncherGroup = (typeof LAUNCHER_GROUPS)[number];

export type LauncherItem = {
  appliesTo?: readonly SurfaceKind[];
  id: string;
  title: string;
  group: LauncherGroup;
  /** Extra match text. Written in both English and Spanish on purpose: the
   * launcher is typed into, and people reach for either. */
  keywords?: string[];
  icon: LauncherIcon;
  /** Tailwind text color for the tile glyph, so the grid is scannable. */
  tint?: string;
  disabledReason?: string;
  run: () => void;
};
