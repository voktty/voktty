import type { ThemeSkin } from "../../types";

/**
 * Tiger Aqua Skin
 *
 * Scoped CSS reproducing the 2005 brushed aluminum and Aqua candy GUI:
 * - Fine horizontal pinstriped header styling
 * - Three iconic candy gelatin traffic light buttons (red, yellow, green)
 * - Translucent Aqua pill tabs with blue highlight glow
 * - Smooth drop-shadow depth and clean high-contrast sans-serif typography
 */
export const TIGER_AQUA_SKIN_CSS = `
/* Window Chrome & Header (Pinstriped Brushed Aluminum) */
[data-theme-skin="tiger-aqua"] header,
[data-theme-skin="tiger-aqua"] .title-bar {
  background: repeating-linear-gradient(
    180deg,
    #ededed 0px,
    #ededed 1px,
    #e1e1e1 1px,
    #e1e1e1 2px
  ) !important;
  color: #202022 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Lucida Grande', sans-serif !important;
  font-weight: bold !important;
  border-bottom: 1px solid #a8a8a8 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
  padding: 3px 8px !important;
}

[data-theme-skin="tiger-aqua"] .window-title {
  color: #202022 !important;
  font-weight: bold !important;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) !important;
}

/* Window Controls (Aqua Gelatin Traffic Lights) */
[data-theme-skin="tiger-aqua"] .window-controls {
  gap: 6px !important;
}

[data-theme-skin="tiger-aqua"] .window-control-button {
  width: 13px !important;
  height: 13px !important;
  min-width: 13px !important;
  border-radius: 50% !important;
  border: 1px solid rgba(0, 0, 0, 0.25) !important;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.8), 0 1px 1px rgba(0, 0, 0, 0.15) !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="tiger-aqua"] .window-control-button * {
  display: none !important;
}

/* Close: Jelly Red */
[data-theme-skin="tiger-aqua"] .window-control-button-close {
  background: radial-gradient(circle at 35% 35%, #ff8a80 0%, #ff5252 50%, #d50000 100%) !important;
}

/* Minimize: Jelly Yellow */
[data-theme-skin="tiger-aqua"] .window-control-button-minimize {
  background: radial-gradient(circle at 35% 35%, #ffe57f 0%, #ffd740 50%, #ffab00 100%) !important;
}

/* Maximize: Jelly Green */
[data-theme-skin="tiger-aqua"] .window-control-button-maximize {
  background: radial-gradient(circle at 35% 35%, #b9f6ca 0%, #69f0ae 50%, #00c853 100%) !important;
}

/* Tabs: Aqua Pill Segmented Controls */
[data-theme-skin="tiger-aqua"] .tab-item,
[data-theme-skin="tiger-aqua"] [data-tab-id] {
  border-radius: 4px 4px 0 0 !important;
  background: linear-gradient(180deg, #f0f2f5 0%, #d8dce2 100%) !important;
  color: #374151 !important;
  border: 1px solid #b4bcc8 !important;
  border-bottom: none !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Lucida Grande', sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 12px !important;
}

[data-theme-skin="tiger-aqua"] .tab-item *,
[data-theme-skin="tiger-aqua"] [data-tab-id] * {
  color: #374151 !important;
}

[data-theme-skin="tiger-aqua"] .tab-active,
[data-theme-skin="tiger-aqua"] [data-tab-active="true"] {
  background: linear-gradient(180deg, #5eb5f7 0%, #208fed 50%, #0076db 100%) !important;
  color: #ffffff !important;
  border-color: #005bb0 !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 1px 3px rgba(0, 118, 219, 0.3) !important;
  font-weight: 600 !important;
}

[data-theme-skin="tiger-aqua"] .tab-active *,
[data-theme-skin="tiger-aqua"] [data-tab-active="true"] * {
  color: #ffffff !important;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.4) !important;
  background: transparent !important;
}

/* Buttons (Glossy Aqua Capsule Buttons) */
[data-theme-skin="tiger-aqua"] button:not(.window-control-button) {
  border-radius: 9999px !important;
  background: linear-gradient(180deg, #ffffff 0%, #e6ebf2 48%, #cfd7e4 52%, #e2e8f0 100%) !important;
  color: #1a202c !important;
  border: 1px solid #94a3b8 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1) !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Lucida Grande', sans-serif !important;
  font-weight: 500 !important;
  padding: 3px 14px !important;
}

[data-theme-skin="tiger-aqua"] button:not(.window-control-button) * {
  color: #1a202c !important;
}

[data-theme-skin="tiger-aqua"] button:not(.window-control-button):hover {
  background: linear-gradient(180deg, #60b6fb 0%, #2293f0 48%, #027be0 52%, #2294f2 100%) !important;
  color: #ffffff !important;
  border-color: #0267ba !important;
}

[data-theme-skin="tiger-aqua"] button:not(.window-control-button):hover * {
  color: #ffffff !important;
}

/* Footer & Status Bar */
[data-theme-skin="tiger-aqua"] footer,
[data-theme-skin="tiger-aqua"] .status-bar {
  background: linear-gradient(180deg, #ededed 0%, #d8d8d8 100%) !important;
  color: #374151 !important;
  border-top: 1px solid #b8b8b8 !important;
}

[data-theme-skin="tiger-aqua"] footer *,
[data-theme-skin="tiger-aqua"] .status-bar * {
  color: #374151 !important;
}

/* Breadcrumbs */
[data-theme-skin="tiger-aqua"] [data-slot="breadcrumb"] *,
[data-theme-skin="tiger-aqua"] [data-slot="breadcrumb-item"] * {
  color: #374151 !important;
}

/* Modals & Dialogs (Translucent Sheet Look) */
[data-theme-skin="tiger-aqua"] [role="dialog"] {
  background: #ffffff !important;
  border: 1px solid #94a3b8 !important;
  border-radius: 8px !important;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25) !important;
}

[data-theme-skin="tiger-aqua"] [role="dialog"] * {
  color: #1a202c !important;
}

/* Inputs */
[data-theme-skin="tiger-aqua"] input,
[data-theme-skin="tiger-aqua"] textarea,
[data-theme-skin="tiger-aqua"] select {
  background: #ffffff !important;
  color: #1a202c !important;
  border: 1px solid #94a3b8 !important;
  border-radius: 4px !important;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1) !important;
}
`;

export const tigerAquaSkin: ThemeSkin = {
  id: "tiger-aqua",
  name: "Tiger Aqua",
  author: "Voktty Team",
  description: "2005 brushed aluminum desktop with glossy candy jelly capsule buttons and smooth drop-shadow depth",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "soft",
    pillRadius: "9999px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "comfortable",
  },
  css: TIGER_AQUA_SKIN_CSS,
};
