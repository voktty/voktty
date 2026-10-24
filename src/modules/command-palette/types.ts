import type { ShortcutId } from "@/modules/shortcuts";
import type { TerminalIcon } from "@hugeicons/core-free-icons";
import type { SurfaceKind } from "@/modules/surfaces/lib/activeSurface";

export type PaletteIcon = typeof TerminalIcon;

export type PaletteItem = {
  appliesTo?: readonly SurfaceKind[];
  id: string;
  title: string;
  group: string;
  keywords?: string[];
  icon?: PaletteIcon;
  iconUrl?: string;
  shortcutId?: ShortcutId;
  trailing?: string;
  disabledReason?: string;
  run: () => void;
};

export type PaletteMode = "commands" | "history" | "content" | "help";
