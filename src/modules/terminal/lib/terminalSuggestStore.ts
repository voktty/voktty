import { create } from "zustand";

export function extractCurrentPromptInput(
  lineText: string,
  cursorX?: number,
): string {
  const text =
    cursorX !== undefined && cursorX >= 0
      ? lineText.slice(0, cursorX)
      : lineText;
  if (!text) return "";

  // Common prompt delimiters across shells (Starship, Bash, Zsh, PowerShell, Fish, etc.)
  const promptMarkers = ["❯", "➜", "»", "$", "%", "#", ">"];
  let lastMarkerIndex = -1;

  for (const marker of promptMarkers) {
    const idx = text.lastIndexOf(marker);
    if (idx > lastMarkerIndex) {
      lastMarkerIndex = idx;
    }
  }

  if (lastMarkerIndex !== -1 && lastMarkerIndex < text.length - 1) {
    return text.slice(lastMarkerIndex + 1).trimStart();
  }

  // Fallback: If line starts with standard prompt formats or just raw text
  const match = text.match(/(?:[$#>❯»%]\s*)(.*)$/);
  if (match && match[1] !== undefined) {
    return match[1].trimStart();
  }

  return text.trimStart();
}

export type TerminalSuggestData = {
  leafId: number;
  open: boolean;
  query: string;
  items: string[];
  rawItems?: string[];
  selectedIndex: number;
  navigated: boolean;
  searchMode?: boolean;
  searchFilter?: string;
  ghostTail: string;
  cursorX: number;
  cursorY: number;
  cellWidth: number;
  cellHeight: number;
  lineX: number;
  lineY: number;
  containerWidth: number;
  containerHeight: number;
};

type TerminalSuggestStore = {
  suggestByLeaf: Record<number, TerminalSuggestData | undefined>;
  setSuggest: (data: TerminalSuggestData) => void;
  clear: (leafId?: number) => void;
  selectNext: (leafId: number) => void;
  selectPrev: (leafId: number) => void;
  setSelectedIndex: (leafId: number, index: number) => void;
  toggleSearch: (leafId: number, open?: boolean) => void;
  setSearchFilter: (leafId: number, filter: string, items?: string[]) => void;
  getSuggest: (leafId: number) => TerminalSuggestData | undefined;
};

export const useTerminalSuggestStore = create<TerminalSuggestStore>(
  (set, get) => ({
    suggestByLeaf: {},

    setSuggest: (data) =>
      set((state) => ({
        suggestByLeaf: {
          ...state.suggestByLeaf,
          [data.leafId]: {
            ...data,
            rawItems: data.rawItems ?? data.items,
          },
        },
      })),

    clear: (leafId) =>
      set((state) => {
        if (leafId === undefined) {
          return { suggestByLeaf: {} };
        }
        if (!state.suggestByLeaf[leafId]) return state;
        const next = { ...state.suggestByLeaf };
        delete next[leafId];
        return { suggestByLeaf: next };
      }),

    selectNext: (leafId) =>
      set((state) => {
        const cur = state.suggestByLeaf[leafId];
        if (!cur || cur.items.length === 0) return state;
        const nextIndex = (cur.selectedIndex + 1) % cur.items.length;
        const selectedCmd = cur.items[nextIndex] ?? "";
        const ghostTail = selectedCmd.startsWith(cur.query)
          ? selectedCmd.slice(cur.query.length)
          : "";
        return {
          suggestByLeaf: {
            ...state.suggestByLeaf,
            [leafId]: {
              ...cur,
              selectedIndex: nextIndex,
              navigated: true,
              ghostTail,
            },
          },
        };
      }),

    selectPrev: (leafId) =>
      set((state) => {
        const cur = state.suggestByLeaf[leafId];
        if (!cur || cur.items.length === 0) return state;
        const prevIndex =
          (cur.selectedIndex - 1 + cur.items.length) % cur.items.length;
        const selectedCmd = cur.items[prevIndex] ?? "";
        const ghostTail = selectedCmd.startsWith(cur.query)
          ? selectedCmd.slice(cur.query.length)
          : "";
        return {
          suggestByLeaf: {
            ...state.suggestByLeaf,
            [leafId]: {
              ...cur,
              selectedIndex: prevIndex,
              navigated: true,
              ghostTail,
            },
          },
        };
      }),

    setSelectedIndex: (leafId, index) =>
      set((state) => {
        const cur = state.suggestByLeaf[leafId];
        if (!cur || cur.items.length === 0) return state;
        const bounded = Math.max(0, Math.min(index, cur.items.length - 1));
        const selectedCmd = cur.items[bounded] ?? "";
        const ghostTail = selectedCmd.startsWith(cur.query)
          ? selectedCmd.slice(cur.query.length)
          : "";
        return {
          suggestByLeaf: {
            ...state.suggestByLeaf,
            [leafId]: {
              ...cur,
              selectedIndex: bounded,
              navigated: true,
              ghostTail,
            },
          },
        };
      }),

    toggleSearch: (leafId, open) =>
      set((state) => {
        const cur = state.suggestByLeaf[leafId];
        if (!cur) return state;
        const nextOpen = open ?? !cur.searchMode;
        return {
          suggestByLeaf: {
            ...state.suggestByLeaf,
            [leafId]: {
              ...cur,
              searchMode: nextOpen,
              navigated: true,
              searchFilter: nextOpen ? cur.searchFilter ?? "" : "",
              items: nextOpen ? cur.items : cur.rawItems ?? cur.items,
            },
          },
        };
      }),

    setSearchFilter: (leafId, filter, newItems) =>
      set((state) => {
        const cur = state.suggestByLeaf[leafId];
        if (!cur) return state;
        const items =
          newItems ??
          (filter.trim()
            ? (cur.rawItems ?? cur.items).filter((cmd) =>
                cmd.toLowerCase().includes(filter.toLowerCase().trim()),
              )
            : (cur.rawItems ?? cur.items));
        const top = items[0];
        const ghostTail =
          top && top.startsWith(cur.query) ? top.slice(cur.query.length) : "";
        return {
          suggestByLeaf: {
            ...state.suggestByLeaf,
            [leafId]: {
              ...cur,
              searchFilter: filter,
              items,
              selectedIndex: 0,
              navigated: true,
              ghostTail,
            },
          },
        };
      }),

    getSuggest: (leafId) => get().suggestByLeaf[leafId],
  }),
);
