import type { ThemeSkin } from "../../types";

/**
 * Macintosh System 1.0 (1984) Radical Skin
 *
 * Scoped CSS and structural traits reproducing the iconic 1-bit monochrome
 * interface with strict legibility:
 * - 6-line horizontal pinstriped titlebar
 * - Isolated window title badge
 * - Square go-away close box and zoom/minimize boxes
 * - Flat 1-bit drop shadows (2px solid black down/right)
 * - Stadium rounded buttons with 1px / 3px borders and crisp black text
 * - 50% dither checkerboard pattern scrollbars
 */
export const MAC1_SKIN_CSS = `
/* Window Chrome & Titlebar */
[data-theme-skin="mac1"] header,
[data-theme-skin="mac1"] .title-bar {
  background: repeating-linear-gradient(
    to bottom,
    #000000 0px,
    #000000 1px,
    #ffffff 1px,
    #ffffff 3px
  ) !important;
  color: #000000 !important;
  font-family: 'Chicago', 'Geneva', 'Charcoal', 'Apple LiGothic', -apple-system, sans-serif !important;
  font-weight: bold !important;
  border-bottom: 1px solid #000000 !important;
  padding: 3px 6px !important;
}

[data-theme-skin="mac1"] .window-title {
  background: #ffffff !important;
  color: #000000 !important;
  padding: 0 8px !important;
  border-left: 1px solid #000000 !important;
  border-right: 1px solid #000000 !important;
}

/* Window Controls (System 1 Classic Boxes) */
[data-theme-skin="mac1"] .window-controls {
  gap: 4px !important;
  padding-right: 4px !important;
}

[data-theme-skin="mac1"] .window-control-button {
  width: 14px !important;
  height: 14px !important;
  min-width: 14px !important;
  border-radius: 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  border: 1px solid #000000 !important;
  box-shadow: 1px 1px 0px #000000 !important;
  position: relative !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="mac1"] .window-control-button:active {
  background: #000000 !important;
  color: #ffffff !important;
  box-shadow: none !important;
}

/* Hide modern SVG icons */
[data-theme-skin="mac1"] .window-control-icon svg {
  display: none !important;
}

/* Go-away close box glyph */
[data-theme-skin="mac1"] .window-control-button-close::after {
  content: "";
  width: 6px;
  height: 6px;
  border: 1px solid #000000;
  display: block;
}

[data-theme-skin="mac1"] .window-control-button-close:active::after {
  border-color: #ffffff;
  background: #ffffff;
}

/* Minimize glyph (horizontal dash) */
[data-theme-skin="mac1"] .window-control-button-minimize::after {
  content: "";
  width: 6px;
  height: 2px;
  background: #000000;
  display: block;
}

[data-theme-skin="mac1"] .window-control-button-minimize:active::after {
  background: #ffffff;
}

/* Maximize zoom glyph */
[data-theme-skin="mac1"] .window-control-button-maximize::after {
  content: "";
  width: 6px;
  height: 6px;
  border: 1px solid #000000;
  display: block;
}

[data-theme-skin="mac1"] .window-control-button-maximize:active::after {
  border-color: #ffffff;
}

/* Buttons (Classic Mac Rounded Rectangle with crisp text) */
[data-theme-skin="mac1"] button:not(.window-control-button) {
  border-radius: 6px !important;
  background: #ffffff !important;
  color: #000000 !important;
  border: 1px solid #000000 !important;
  box-shadow: 1px 1px 0px #000000 !important;
  font-family: 'Chicago', 'Geneva', sans-serif !important;
  font-weight: 500 !important;
}

[data-theme-skin="mac1"] button:not(.window-control-button) * {
  color: #000000 !important;
}

[data-theme-skin="mac1"] button:not(.window-control-button):active {
  background: #000000 !important;
  color: #ffffff !important;
  box-shadow: none !important;
}

[data-theme-skin="mac1"] button:not(.window-control-button):active * {
  color: #ffffff !important;
}

/* Tabs: High Contrast */
[data-theme-skin="mac1"] .tab-item,
[data-theme-skin="mac1"] [data-tab-id] {
  border-radius: 4px 4px 0 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  border: 1px solid #000000 !important;
  border-bottom: none !important;
  margin-right: 2px !important;
}

[data-theme-skin="mac1"] .tab-item *,
[data-theme-skin="mac1"] [data-tab-id] * {
  color: #000000 !important;
}

[data-theme-skin="mac1"] .tab-active,
[data-theme-skin="mac1"] [data-tab-active="true"] {
  background: #000000 !important;
  color: #ffffff !important;
  font-weight: bold !important;
}

[data-theme-skin="mac1"] .tab-active *,
[data-theme-skin="mac1"] [data-tab-active="true"] * {
  color: #ffffff !important;
  background: transparent !important;
}

/* Breadcrumbs & Statusbar */
[data-theme-skin="mac1"] [data-slot="breadcrumb"] *,
[data-theme-skin="mac1"] [data-slot="breadcrumb-item"] *,
[data-theme-skin="mac1"] footer,
[data-theme-skin="mac1"] footer *,
[data-theme-skin="mac1"] .status-bar,
[data-theme-skin="mac1"] .status-bar * {
  color: #000000 !important;
}

/* Panels, Surfaces & Terminal Slot: 1-bit crisp borders & drop shadow */
[data-theme-skin="mac1"] .surface-pane,
[data-theme-skin="mac1"] [data-slot-kind="terminal"] {
  border: 1px solid #000000 !important;
  box-shadow: 2px 2px 0px #000000 !important;
}

/* Input Fields */
[data-theme-skin="mac1"] input,
[data-theme-skin="mac1"] textarea,
[data-theme-skin="mac1"] select {
  border-radius: 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  border: 1px solid #000000 !important;
}

/* Focus indicator */
[data-theme-skin="mac1"] *:focus-visible {
  outline: 2px solid #000000 !important;
  outline-offset: 1px !important;
}

/* 1-bit Checkerboard Scrollbars */
[data-theme-skin="mac1"] ::-webkit-scrollbar {
  width: 16px !important;
  height: 16px !important;
}

[data-theme-skin="mac1"] ::-webkit-scrollbar-track {
  background-color: #ffffff !important;
  background-image: repeating-conic-gradient(#000000 0% 25%, #ffffff 0% 50%) !important;
  background-size: 2px 2px !important;
  border-left: 1px solid #000000 !important;
}

[data-theme-skin="mac1"] ::-webkit-scrollbar-thumb {
  background: #ffffff !important;
  border: 1px solid #000000 !important;
  box-shadow: 1px 1px 0px #000000 !important;
}
`;

export const mac1Skin: ThemeSkin = {
  id: "mac1",
  name: "Macintosh System 1",
  description: "Authentic 1984 1-bit monochrome GUI with pinstriped titlebar and go-away close box",
  author: "Apple / Voktty Team",
  css: MAC1_SKIN_CSS,
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "flat",
    pillRadius: "8px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "invert",
    uiFontFamily: "'Chicago', 'Geneva', 'Charcoal', 'Apple LiGothic', -apple-system, sans-serif",
    uiFontSmoothing: "none",
    density: "compact",
    windowCorners: "round",
  },
};
