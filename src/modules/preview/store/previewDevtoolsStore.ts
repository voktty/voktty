import { create } from "zustand";
import type {
  ConsoleEntry,
  ConsoleLogLevel,
  ViewportMode,
  ViewportPreset,
} from "../types";

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  {
    id: "iphone-16-pro",
    name: "iPhone 16 Pro",
    category: "mobile",
    width: 393,
    height: 852,
    devicePixelRatio: 3,
  },
  {
    id: "iphone-se",
    name: "iPhone SE",
    category: "mobile",
    width: 375,
    height: 667,
    devicePixelRatio: 2,
  },
  {
    id: "pixel-8",
    name: "Pixel 8",
    category: "mobile",
    width: 412,
    height: 915,
    devicePixelRatio: 2.6,
  },
  {
    id: "ipad-air",
    name: "iPad Air",
    category: "tablet",
    width: 820,
    height: 1180,
    devicePixelRatio: 2,
  },
  {
    id: "ipad-pro-11",
    name: "iPad Pro 11\"",
    category: "tablet",
    width: 834,
    height: 1194,
    devicePixelRatio: 2,
  },
  {
    id: "laptop-1366",
    name: "Laptop (1366×768)",
    category: "laptop",
    width: 1366,
    height: 768,
    devicePixelRatio: 1,
  },
  {
    id: "desktop-1920",
    name: "Desktop FHD (1920×1080)",
    category: "desktop",
    width: 1920,
    height: 1080,
    devicePixelRatio: 1,
  },
];

export type ConsoleFilter = "all" | ConsoleLogLevel;

export interface PreviewDevtoolsState {
  // Viewport emulation state
  viewportMode: ViewportMode;
  activePresetId: string | null;
  customWidth: number | null;
  customHeight: number | null;
  isLandscape: boolean;
  scale: number; // 0 = fit/auto, 0.5 = 50%, 0.75 = 75%, 1 = 100%, etc.
  showDeviceFrame: boolean;

  // DevTools Console state
  consoleEntries: ConsoleEntry[];
  consoleFilter: ConsoleFilter;
  consoleSearch: string;
  isConsoleOpen: boolean;

  // Viewport actions
  setViewportMode: (mode: ViewportMode) => void;
  selectPreset: (presetId: string | null) => void;
  setCustomDimensions: (width: number | null, height: number | null) => void;
  toggleLandscape: () => void;
  setScale: (scale: number) => void;
  setShowDeviceFrame: (show: boolean) => void;
  resetViewport: () => void;

  // Console actions
  addConsoleEntry: (entry: Omit<ConsoleEntry, "count">) => void;
  clearConsole: () => void;
  setConsoleFilter: (filter: ConsoleFilter) => void;
  setConsoleSearch: (query: string) => void;
  toggleConsole: (open?: boolean) => void;
}

export const usePreviewDevtoolsStore = create<PreviewDevtoolsState>((set, get) => ({
  viewportMode: "responsive",
  activePresetId: null,
  customWidth: null,
  customHeight: null,
  isLandscape: false,
  scale: 1,
  showDeviceFrame: true,

  consoleEntries: [],
  consoleFilter: "all",
  consoleSearch: "",
  isConsoleOpen: false,

  setViewportMode: (mode) => {
    if (mode === "responsive") {
      set({
        viewportMode: "responsive",
        activePresetId: null,
        customWidth: null,
        customHeight: null,
      });
    } else {
      set({ viewportMode: mode });
    }
  },

  selectPreset: (presetId) => {
    if (!presetId) {
      set({
        viewportMode: "responsive",
        activePresetId: null,
        customWidth: null,
        customHeight: null,
      });
      return;
    }
    const preset = VIEWPORT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    set({
      viewportMode: preset.category,
      activePresetId: preset.id,
      customWidth: preset.width,
      customHeight: preset.height,
      isLandscape: false,
    });
  },

  setCustomDimensions: (width, height) => {
    set({
      viewportMode: width && height ? "custom" : "responsive",
      activePresetId: null,
      customWidth: width,
      customHeight: height,
    });
  },

  toggleLandscape: () => {
    const { isLandscape, customWidth, customHeight } = get();
    if (customWidth && customHeight) {
      set({
        isLandscape: !isLandscape,
        customWidth: customHeight,
        customHeight: customWidth,
      });
    } else {
      set({ isLandscape: !isLandscape });
    }
  },

  setScale: (scale) => set({ scale }),
  setShowDeviceFrame: (showDeviceFrame) => set({ showDeviceFrame }),

  resetViewport: () =>
    set({
      viewportMode: "responsive",
      activePresetId: null,
      customWidth: null,
      customHeight: null,
      isLandscape: false,
      scale: 1,
    }),

  addConsoleEntry: (newEntry) => {
    set((state) => {
      const last = state.consoleEntries[state.consoleEntries.length - 1];
      if (
        last &&
        last.level === newEntry.level &&
        last.message === newEntry.message
      ) {
        // Group consecutive duplicate log messages
        const updated = [...state.consoleEntries];
        updated[updated.length - 1] = {
          ...last,
          count: last.count + 1,
          timestamp: newEntry.timestamp,
        };
        return { consoleEntries: updated };
      }

      // Max 200 console entries
      const nextEntries = [...state.consoleEntries, { ...newEntry, count: 1 }];
      if (nextEntries.length > 200) {
        nextEntries.shift();
      }
      return { consoleEntries: nextEntries };
    });
  },

  clearConsole: () => set({ consoleEntries: [] }),
  setConsoleFilter: (consoleFilter) => set({ consoleFilter }),
  setConsoleSearch: (consoleSearch) => set({ consoleSearch }),
  toggleConsole: (open) =>
    set((state) => ({
      isConsoleOpen: typeof open === "boolean" ? open : !state.isConsoleOpen,
    })),
}));

export function formatConsoleErrorPrompt(entry: ConsoleEntry): string {
  const parts: string[] = [
    "### 🐛 Solicitud de Solución de Error en Consola",
    `- **Nivel**: \`${entry.level.toUpperCase()}\``,
    `- **Mensaje**: \`\`\`\n${entry.message}\n\`\`\``,
  ];

  if (entry.source?.file) {
    const loc = entry.source.line ? `:${entry.source.line}` : "";
    parts.push(`- **Ubicación**: \`${entry.source.file}${loc}\``);
  }

  if (entry.stack) {
    parts.push(`- **Stack Trace**:\n\`\`\`\n${entry.stack}\n\`\`\``);
  }

  parts.push(
    "- **Objetivo**:\nAnaliza la causa raíz de esta excepción/error y realiza las correcciones necesarias en el código para resolverlo.",
  );

  return parts.join("\n");
}
