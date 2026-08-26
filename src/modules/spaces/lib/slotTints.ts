import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WindowTintPreset = {
  id: string;
  name: string;
  bg: string;
  border: string;
  dot: string;
};

export const WINDOW_TINT_PRESETS: readonly WindowTintPreset[] = [
  {
    id: "blue",
    name: "Blue",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.35)",
    dot: "oklch(0.62 0.17 254)",
  },
  {
    id: "violet",
    name: "Violet",
    bg: "rgba(139, 92, 246, 0.12)",
    border: "rgba(139, 92, 246, 0.35)",
    dot: "oklch(0.60 0.18 296)",
  },
  {
    id: "emerald",
    name: "Emerald",
    bg: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.35)",
    dot: "oklch(0.65 0.16 162)",
  },
  {
    id: "amber",
    name: "Amber",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.35)",
    dot: "oklch(0.74 0.16 78)",
  },
  {
    id: "rose",
    name: "Rose",
    bg: "rgba(244, 63, 94, 0.12)",
    border: "rgba(244, 63, 94, 0.35)",
    dot: "oklch(0.64 0.20 18)",
  },
  {
    id: "cyan",
    name: "Cyan",
    bg: "rgba(6, 182, 212, 0.12)",
    border: "rgba(6, 182, 212, 0.35)",
    dot: "oklch(0.68 0.13 212)",
  },
  {
    id: "orange",
    name: "Orange",
    bg: "rgba(249, 115, 22, 0.12)",
    border: "rgba(249, 115, 22, 0.35)",
    dot: "oklch(0.68 0.18 44)",
  },
  {
    id: "pink",
    name: "Pink",
    bg: "rgba(236, 72, 153, 0.12)",
    border: "rgba(236, 72, 153, 0.35)",
    dot: "oklch(0.66 0.19 350)",
  },
] as const;

type SlotTintsState = {
  tints: Record<string, string>;
  setTint: (key: string, tintId: string | null) => void;
  getTint: (
    spaceId: string,
    slotId: string,
    tabKey?: string,
  ) => WindowTintPreset | null;
};

export const useSlotTints = create<SlotTintsState>()(
  persist(
    (set, get) => ({
      tints: {},
      setTint: (key, tintId) => {
        set((state) => {
          const next = { ...state.tints };
          if (tintId) {
            next[key] = tintId;
          } else {
            delete next[key];
          }
          return { tints: next };
        });
      },
      getTint: (spaceId, slotId, tabKey) => {
        const { tints } = get();
        const tintId =
          tints[`${spaceId}:${slotId}`] ||
          (tabKey ? tints[tabKey] : null) ||
          tints[slotId];
        if (!tintId) return null;
        return WINDOW_TINT_PRESETS.find((p) => p.id === tintId) ?? null;
      },
    }),
    {
      name: "voktty-slot-tints",
    },
  ),
);
