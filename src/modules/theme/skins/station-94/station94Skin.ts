import type { ThemeSkin } from "../../types";

/**
 * Station 94 Skin
 *
 * Scoped CSS reproducing the legendary 32-bit console:
 * - Matte console dark slate (#252830) and memory card indigo (#003791)
 * - Geometrical control glyphs (green triangle, red circle, blue cross, pink square)
 * - Beveled console memory card bay panels
 * - High contrast white and cyan indicators on dark console casing
 */
export const STATION_94_SKIN_CSS = `
/* Window Chrome & Header (Memory Card Bay) */
[data-theme-skin="station-94"] header,
[data-theme-skin="station-94"] .title-bar {
  background: linear-gradient(180deg, #102040 0%, #001838 100%) !important;
  color: #00f0ff !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #003791 !important;
  box-shadow: inset 0 1px 0 #1e3a70 !important;
  padding: 3px 8px !important;
}

[data-theme-skin="station-94"] .window-title {
  color: #00f0ff !important;
  font-weight: bold !important;
  letter-spacing: 0.5px !important;
}

/* Window Controls (Geometrical Pad Symbols) */
[data-theme-skin="station-94"] .window-controls {
  gap: 4px !important;
}

[data-theme-skin="station-94"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 50% !important;
  background: #252830 !important;
  color: #00f0ff !important;
  border: 1px solid #003791 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="station-94"] .window-control-button * {
  color: #00f0ff !important;
}

[data-theme-skin="station-94"] .window-control-button:hover {
  background: #003791 !important;
  color: #ffffff !important;
}

[data-theme-skin="station-94"] .window-control-button-close:hover {
  background: #ff0055 !important;
  color: #ffffff !important;
}

/* Tabs: Memory Card Block Slots */
[data-theme-skin="station-94"] .tab-item,
[data-theme-skin="station-94"] [data-tab-id] {
  border-radius: 3px 3px 0 0 !important;
  background: #1c1e24 !important;
  color: #a0a6b4 !important;
  border: 1px solid #14161a !important;
  border-bottom: none !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="station-94"] .tab-item *,
[data-theme-skin="station-94"] [data-tab-id] * {
  color: #a0a6b4 !important;
}

[data-theme-skin="station-94"] .tab-active,
[data-theme-skin="station-94"] [data-tab-active="true"] {
  background: #30343f !important;
  color: #00f0ff !important;
  border-color: #003791 !important;
  border-top: 2px solid #00f0ff !important;
  font-weight: bold !important;
}

[data-theme-skin="station-94"] .tab-active *,
[data-theme-skin="station-94"] [data-tab-active="true"] * {
  color: #00f0ff !important;
  background: transparent !important;
}

/* Buttons (Console Action Buttons) */
[data-theme-skin="station-94"] button:not(.window-control-button) {
  border-radius: 4px !important;
  background: linear-gradient(180deg, #3a3e4c 0%, #292c36 100%) !important;
  color: #f0f2f5 !important;
  border: 1px solid #1a1c22 !important;
  box-shadow: inset 0 1px 0 #4f5568, 0 2px 4px rgba(0, 0, 0, 0.4) !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 12px !important;
}

[data-theme-skin="station-94"] button:not(.window-control-button) * {
  color: #f0f2f5 !important;
}

[data-theme-skin="station-94"] button:not(.window-control-button):hover {
  background: #003791 !important;
  border-color: #00f0ff !important;
}

/* Footer & Status Bar */
[data-theme-skin="station-94"] footer,
[data-theme-skin="station-94"] .status-bar {
  background: #14161a !important;
  color: #a0a6b4 !important;
  border-top: 1px solid #20232a !important;
}

[data-theme-skin="station-94"] footer *,
[data-theme-skin="station-94"] .status-bar * {
  color: #a0a6b4 !important;
}

/* Breadcrumbs */
[data-theme-skin="station-94"] [data-slot="breadcrumb"] *,
[data-theme-skin="station-94"] [data-slot="breadcrumb-item"] * {
  color: #00f0ff !important;
}

/* Modals & Dialogs */
[data-theme-skin="station-94"] [role="dialog"] {
  background: #252830 !important;
  border: 2px solid #003791 !important;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6) !important;
}

[data-theme-skin="station-94"] [role="dialog"] * {
  color: #f0f2f5 !important;
}

/* Inputs */
[data-theme-skin="station-94"] input,
[data-theme-skin="station-94"] textarea,
[data-theme-skin="station-94"] select {
  background: #181a20 !important;
  color: #f0f2f5 !important;
  border: 1px solid #30343f !important;
  border-radius: 3px !important;
}
`;

export const station94Skin: ThemeSkin = {
  id: "station-94",
  name: "Station 94",
  author: "Voktty Team",
  description: "Classic 32-bit console matte gray casing with deep memory card indigo and geometric action symbols",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "comfortable",
  },
  css: STATION_94_SKIN_CSS,
};
