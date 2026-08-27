import { create } from "zustand";
import { persist } from "zustand/middleware";

export type HighlightColor =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "purple";

export type DocumentHighlight = {
  id: string;
  filePath: string;
  from: number;
  to: number;
  text: string;
  color: HighlightColor;
  createdAt: number;
};

export function normalizeHighlightPath(filePath: string): string {
  const unified = filePath.replace(/\\/g, "/").trim();
  return /^[a-z]:\//i.test(unified)
    ? unified.toLowerCase()
    : unified;
}

type DocumentHighlightState = {
  highlightsByPath: Record<string, DocumentHighlight[]>;
  addHighlight: (
    filePath: string,
    params: {
      from: number;
      to: number;
      text: string;
      color?: HighlightColor;
    },
  ) => DocumentHighlight;
  removeHighlight: (filePath: string, id: string) => void;
  removeHighlightByText: (filePath: string, text: string) => void;
  removeHighlightsInRange: (
    filePath: string,
    from: number,
    to: number,
  ) => void;
  clearHighlights: (filePath: string) => void;
  getHighlights: (filePath: string) => DocumentHighlight[];
  setHighlights: (filePath: string, list: DocumentHighlight[]) => void;
};

export const useDocumentHighlightStore = create<DocumentHighlightState>()(
  persist(
    (set, get) => ({
      highlightsByPath: {},

      addHighlight: (filePath, params) => {
        const key = normalizeHighlightPath(filePath);
        const existing = get().highlightsByPath[key] ?? [];
        const start = Math.min(params.from, params.to);
        const end = Math.max(params.from, params.to);
        const newHighlight: DocumentHighlight = {
          id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          filePath,
          from: start,
          to: end,
          text: params.text,
          color: params.color ?? "yellow",
          createdAt: Date.now(),
        };

        // Filter out completely eclipsed highlights or duplicate ranges
        const filtered = existing.filter(
          (h) => !(h.from >= start && h.to <= end),
        );

        const updated = [...filtered, newHighlight].sort(
          (a, b) => a.from - b.from,
        );

        set((state) => ({
          highlightsByPath: {
            ...state.highlightsByPath,
            [key]: updated,
          },
        }));

        return newHighlight;
      },

      removeHighlight: (filePath, id) => {
        const key = normalizeHighlightPath(filePath);
        const existing = get().highlightsByPath[key];
        if (!existing) return;

        set((state) => ({
          highlightsByPath: {
            ...state.highlightsByPath,
            [key]: existing.filter((h) => h.id !== id),
          },
        }));
      },

      removeHighlightByText: (filePath, text) => {
        const key = normalizeHighlightPath(filePath);
        const existing = get().highlightsByPath[key];
        if (!existing) return;

        const trimmed = text.trim();
        set((state) => ({
          highlightsByPath: {
            ...state.highlightsByPath,
            [key]: existing.filter(
              (h) => h.text.trim() !== trimmed && !h.text.includes(trimmed),
            ),
          },
        }));
      },

      removeHighlightsInRange: (filePath, from, to) => {
        const key = normalizeHighlightPath(filePath);
        const existing = get().highlightsByPath[key];
        if (!existing) return;

        const start = Math.min(from, to);
        const end = Math.max(from, to);

        const updated = existing.filter(
          (h) => h.to <= start || h.from >= end,
        );

        set((state) => ({
          highlightsByPath: {
            ...state.highlightsByPath,
            [key]: updated,
          },
        }));
      },

      clearHighlights: (filePath) => {
        const key = normalizeHighlightPath(filePath);
        set((state) => {
          const next = { ...state.highlightsByPath };
          delete next[key];
          return { highlightsByPath: next };
        });
      },

      getHighlights: (filePath) => {
        const key = normalizeHighlightPath(filePath);
        return get().highlightsByPath[key] ?? [];
      },

      setHighlights: (filePath, list) => {
        const key = normalizeHighlightPath(filePath);
        set((state) => ({
          highlightsByPath: {
            ...state.highlightsByPath,
            [key]: list,
          },
        }));
      },
    }),
    {
      name: "voktty-document-highlights",
    },
  ),
);
