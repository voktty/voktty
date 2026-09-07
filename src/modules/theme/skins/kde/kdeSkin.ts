import type { ThemeSkin } from "../../types";

/**
 * KDE Classic Radical Skin
 *
 * Scoped CSS and structural traits reproducing classic KDE 2/3 / Keramik desktop:
 * - Signature royal blue horizontal gradient titlebar
 * - Beveled metallic buttons and window controls with crisp dark icons
 * - Qt-style beveled tabs with blue active indicator and high-contrast text
 * - Inset 3D panels with subtle slate borders
 * - KDE Konsole terminal styling
 */
export const KDE_SKIN_CSS = `
/* Window Chrome & Titlebar (Signature KDE Horizontal Gradient) */
[data-theme-skin="kde"] header,
[data-theme-skin="kde"] .title-bar {
  background: linear-gradient(90deg, #0a5f9e 0%, #2985c4 45%, #55a8e0 100%) !important;
  color: #ffffff !important;
  font-family: 'DejaVu Sans', 'Liberation Sans', 'Segoe UI', Tahoma, sans-serif !important;
  font-weight: bold !important;
  border-bottom: 1px solid #084c7e !important;
  padding: 3px 8px !important;
  text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.6) !important;
}

[data-theme-skin="kde"] .window-title {
  color: #ffffff !important;
}

/* Window Controls (Classic Beveled Rectangles) */
[data-theme-skin="kde"] .window-controls {
  gap: 3px !important;
  padding-right: 4px !important;
}

[data-theme-skin="kde"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 3px !important;
  background: linear-gradient(to bottom, #f2f5f8 0%, #d8e2ea 50%, #c4d0dc 100%) !important;
  color: #1c2b36 !important;
  border: 1px solid #5a748c !important;
  box-shadow: inset 1px 1px 0px #ffffff, inset -1px -1px 0px #9bb0c2 !important;
  position: relative !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="kde"] .window-control-button * {
  color: #1c2b36 !important;
}

[data-theme-skin="kde"] .window-control-button:hover {
  background: linear-gradient(to bottom, #ffffff 0%, #e3ecf5 100%) !important;
  color: #0a5f9e !important;
}

[data-theme-skin="kde"] .window-control-button:hover * {
  color: #0a5f9e !important;
}

[data-theme-skin="kde"] .window-control-button:active {
  background: linear-gradient(to bottom, #b4c2ce 0%, #d0dbe4 100%) !important;
  box-shadow: inset 1px 1px 2px #405566 !important;
}

[data-theme-skin="kde"] .window-control-button-close:hover {
  background: #d94040 !important;
  border-color: #a82020 !important;
  color: #ffffff !important;
}

[data-theme-skin="kde"] .window-control-button-close:hover * {
  color: #ffffff !important;
}

/* Notebook Tabs (Qt / KDE 3 Style): High-Contrast */
[data-theme-skin="kde"] .tab-item,
[data-theme-skin="kde"] [data-tab-id] {
  border-radius: 3px 3px 0 0 !important;
  background: #d8e0e8 !important;
  color: #1c2b36 !important;
  border: 1px solid #99aab8 !important;
  border-bottom: none !important;
  margin-right: 2px !important;
}

[data-theme-skin="kde"] .tab-item *,
[data-theme-skin="kde"] [data-tab-id] * {
  color: #1c2b36 !important;
}

[data-theme-skin="kde"] .tab-active,
[data-theme-skin="kde"] [data-tab-active="true"] {
  background: #ffffff !important;
  color: #0a5f9e !important;
  font-weight: bold !important;
  border-top: 2px solid #0a5f9e !important;
  border-bottom: none !important;
}

[data-theme-skin="kde"] .tab-active *,
[data-theme-skin="kde"] [data-tab-active="true"] * {
  color: #0a5f9e !important;
  background: transparent !important;
}

/* Buttons */
[data-theme-skin="kde"] button:not(.window-control-button) {
  border-radius: 3px !important;
  background: linear-gradient(to bottom, #f6f8fa 0%, #e2e8ee 50%, #ccd7e2 100%) !important;
  color: #1c2b36 !important;
  border: 1px solid #758f9e !important;
  box-shadow: inset 1px 1px 0px #ffffff, 0 1px 1px rgba(0, 0, 0, 0.1) !important;
  font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif !important;
}

[data-theme-skin="kde"] button:not(.window-control-button) * {
  color: #1c2b36 !important;
}

[data-theme-skin="kde"] button:not(.window-control-button):hover {
  background: linear-gradient(to bottom, #ffffff 0%, #eaf1f7 100%) !important;
  border-color: #308ecb !important;
}

[data-theme-skin="kde"] button:not(.window-control-button):active {
  background: linear-gradient(to bottom, #ccd7e2 0%, #e2e8ee 100%) !important;
  box-shadow: inset 1px 1px 2px rgba(0, 0, 0, 0.25) !important;
}

/* Breadcrumbs & Statusbar */
[data-theme-skin="kde"] [data-slot="breadcrumb"] *,
[data-theme-skin="kde"] [data-slot="breadcrumb-item"] *,
[data-theme-skin="kde"] footer,
[data-theme-skin="kde"] footer *,
[data-theme-skin="kde"] .status-bar,
[data-theme-skin="kde"] .status-bar * {
  color: #1c2b36 !important;
}

/* Panels, Surfaces & Terminal Slot: Inset 3D frame */
[data-theme-skin="kde"] .surface-pane,
[data-theme-skin="kde"] [data-slot-kind="terminal"] {
  border: 1px solid #9bb0c2 !important;
  box-shadow: inset 1px 1px 2px rgba(0, 0, 0, 0.08) !important;
}

/* Input Fields */
[data-theme-skin="kde"] input,
[data-theme-skin="kde"] textarea,
[data-theme-skin="kde"] select {
  border-radius: 2px !important;
  background: #ffffff !important;
  color: #000000 !important;
  border: 1px solid #758f9e !important;
  box-shadow: inset 1px 1px 2px rgba(0, 0, 0, 0.1) !important;
}

/* Focus Ring */
[data-theme-skin="kde"] *:focus-visible {
  outline: 2px solid #0a5f9e !important;
  outline-offset: 1px !important;
}

/* KDE Scrollbars */
[data-theme-skin="kde"] ::-webkit-scrollbar {
  width: 14px !important;
  height: 14px !important;
}

[data-theme-skin="kde"] ::-webkit-scrollbar-track {
  background: #e4ebf2 !important;
  border-left: 1px solid #c2d0dc !important;
}

[data-theme-skin="kde"] ::-webkit-scrollbar-thumb {
  background: linear-gradient(to right, #dbe4ec, #c8d5e2) !important;
  border: 1px solid #9ab0c2 !important;
  border-radius: 2px !important;
  box-shadow: inset 1px 1px 0px #ffffff !important;
}
`;

export const kdeSkin: ThemeSkin = {
  id: "kde",
  name: "KDE Classic",
  description: "Authentic classic KDE 2/3 desktop skin with signature blue gradient titlebar and beveled Qt controls",
  author: "KDE Community / Voktty Team",
  css: KDE_SKIN_CSS,
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "3px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontFamily: "'DejaVu Sans', 'Liberation Sans', 'Segoe UI', Tahoma, sans-serif",
    uiFontSmoothing: "antialiased",
    density: "compact",
    windowCorners: "round",
  },
};
