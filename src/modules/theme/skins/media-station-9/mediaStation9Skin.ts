import type { ThemeSkin } from "../../types";

/**
 * Media Station 9 Skin
 *
 * Scoped CSS reproducing the electric cobalt media player aesthetic:
 * - Deep cobalt curves and metallic audio theater framing (#0c192c)
 * - Glowing halo playback indicators in electric neon cyan (#00d2ff)
 * - Rounded capsule pill controls and glossy playback buttons
 * - High contrast white and neon cyan typography
 */
export const MEDIA_STATION_9_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="media-station-9"] header,
[data-theme-skin="media-station-9"] .title-bar {
  background: linear-gradient(180deg, #10243e 0%, #081220 100%) !important;
  color: #00d2ff !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #0055aa !important;
  box-shadow: 0 1px 4px rgba(0, 210, 255, 0.2) !important;
  padding: 3px 8px !important;
}

[data-theme-skin="media-station-9"] .window-title {
  color: #00d2ff !important;
  font-weight: bold !important;
  letter-spacing: 0.5px !important;
  text-shadow: 0 0 8px rgba(0, 210, 255, 0.6) !important;
}

/* Window Controls (Electric Blue Rounded Buttons) */
[data-theme-skin="media-station-9"] .window-controls {
  gap: 4px !important;
}

[data-theme-skin="media-station-9"] .window-control-button {
  width: 17px !important;
  height: 17px !important;
  min-width: 17px !important;
  border-radius: 50% !important;
  background: linear-gradient(180deg, #16365c 0%, #0c1e34 100%) !important;
  color: #00d2ff !important;
  border: 1px solid #0066cc !important;
  box-shadow: 0 0 4px rgba(0, 210, 255, 0.3) !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="media-station-9"] .window-control-button * {
  color: #00d2ff !important;
}

[data-theme-skin="media-station-9"] .window-control-button:hover {
  background: #0066cc !important;
  color: #ffffff !important;
  box-shadow: 0 0 8px #00d2ff !important;
}

[data-theme-skin="media-station-9"] .window-control-button:hover * {
  color: #ffffff !important;
}

[data-theme-skin="media-station-9"] .window-control-button-close:hover {
  background: #e60040 !important;
  border-color: #ff3366 !important;
  box-shadow: 0 0 8px #ff0055 !important;
}

/* Tabs: Glowing Capsule Tabs */
[data-theme-skin="media-station-9"] .tab-item,
[data-theme-skin="media-station-9"] [data-tab-id] {
  border-radius: 9999px !important;
  background: #0e1c2e !important;
  color: #8ca6c8 !important;
  border: 1px solid #1a3456 !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  margin-right: 3px !important;
  padding: 2px 12px !important;
}

[data-theme-skin="media-station-9"] .tab-item *,
[data-theme-skin="media-station-9"] [data-tab-id] * {
  color: #8ca6c8 !important;
}

[data-theme-skin="media-station-9"] .tab-active,
[data-theme-skin="media-station-9"] [data-tab-active="true"] {
  background: linear-gradient(180deg, #0077e6 0%, #004499 100%) !important;
  color: #ffffff !important;
  border-color: #00d2ff !important;
  box-shadow: 0 0 6px rgba(0, 210, 255, 0.4) !important;
  font-weight: bold !important;
}

[data-theme-skin="media-station-9"] .tab-active *,
[data-theme-skin="media-station-9"] [data-tab-active="true"] * {
  color: #ffffff !important;
  background: transparent !important;
}

/* Buttons (Curved Capsule Controls) */
[data-theme-skin="media-station-9"] button:not(.window-control-button) {
  border-radius: 9999px !important;
  background: linear-gradient(180deg, #1b3860 0%, #0e2038 100%) !important;
  color: #ffffff !important;
  border: 1px solid #0066cc !important;
  box-shadow: 0 0 4px rgba(0, 102, 204, 0.3) !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 14px !important;
}

[data-theme-skin="media-station-9"] button:not(.window-control-button) * {
  color: #ffffff !important;
}

[data-theme-skin="media-station-9"] button:not(.window-control-button):hover {
  background: #0066cc !important;
  border-color: #00d2ff !important;
  box-shadow: 0 0 8px rgba(0, 210, 255, 0.6) !important;
}

/* Footer & Status Bar */
[data-theme-skin="media-station-9"] footer,
[data-theme-skin="media-station-9"] .status-bar {
  background: #070e18 !important;
  color: #8ca6c8 !important;
  border-top: 1px solid #142844 !important;
}

[data-theme-skin="media-station-9"] footer *,
[data-theme-skin="media-station-9"] .status-bar * {
  color: #8ca6c8 !important;
}

/* Breadcrumbs */
[data-theme-skin="media-station-9"] [data-slot="breadcrumb"] *,
[data-theme-skin="media-station-9"] [data-slot="breadcrumb-item"] * {
  color: #00d2ff !important;
}

/* Modals & Dialogs */
[data-theme-skin="media-station-9"] [role="dialog"] {
  background: #0c192c !important;
  border: 2px solid #0066cc !important;
  box-shadow: 0 0 20px rgba(0, 102, 204, 0.5) !important;
}

[data-theme-skin="media-station-9"] [role="dialog"] * {
  color: #ffffff !important;
}

/* Inputs */
[data-theme-skin="media-station-9"] input,
[data-theme-skin="media-station-9"] textarea,
[data-theme-skin="media-station-9"] select {
  background: #081220 !important;
  color: #ffffff !important;
  border: 1px solid #1c3b64 !important;
  border-radius: 4px !important;
}
`;

export const mediaStation9Skin: ThemeSkin = {
  id: "media-station-9",
  name: "Media Station 9",
  author: "Voktty Team",
  description: "Electric cobalt blue media player with glossy pill curves, glowing halo playback indicators and neon cyan accents",
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
  css: MEDIA_STATION_9_SKIN_CSS,
};
