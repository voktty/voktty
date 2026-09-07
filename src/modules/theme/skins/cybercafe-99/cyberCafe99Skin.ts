import type { ThemeSkin } from "../../types";

/**
 * CyberCafe 99 Skin
 *
 * Scoped CSS reproducing the 1999 cybercafé dial-up and Windows 98 aesthetic:
 * - Iconic navy-to-cyan gradient titlebar with crisp white bold title
 * - Classic silver beveled cards (#c0c0c0) with inset 3D sunken panes
 * - High-contrast black text on all windows and menus
 * - ICQ flower green accents (#00ff00) and retro dial-up status styling
 */
export const CYBER_CAFE_99_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="cybercafe-99"] header,
[data-theme-skin="cybercafe-99"] .title-bar {
  background: linear-gradient(90deg, #000080 0%, #1084d0 100%) !important;
  color: #ffffff !important;
  font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #000040 !important;
  padding: 3px 8px !important;
}

[data-theme-skin="cybercafe-99"] .window-title {
  color: #ffffff !important;
  font-weight: bold !important;
}

/* Window Controls (Classic Beveled 98 Controls) */
[data-theme-skin="cybercafe-99"] .window-controls {
  gap: 2px !important;
}

[data-theme-skin="cybercafe-99"] .window-control-button {
  width: 16px !important;
  height: 14px !important;
  min-width: 16px !important;
  border-radius: 0 !important;
  background: #c0c0c0 !important;
  color: #000000 !important;
  border-top: 1px solid #ffffff !important;
  border-left: 1px solid #ffffff !important;
  border-right: 1px solid #404040 !important;
  border-bottom: 1px solid #404040 !important;
  box-shadow: inset 1px 1px 0 #dfdfdf, inset -1px -1px 0 #808080 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="cybercafe-99"] .window-control-button * {
  color: #000000 !important;
}

[data-theme-skin="cybercafe-99"] .window-control-button:active {
  border-top: 1px solid #404040 !important;
  border-left: 1px solid #404040 !important;
  border-right: 1px solid #ffffff !important;
  border-bottom: 1px solid #ffffff !important;
}

/* Tabs: Classic Win98 Notebook Tabs */
[data-theme-skin="cybercafe-99"] .tab-item,
[data-theme-skin="cybercafe-99"] [data-tab-id] {
  border-radius: 2px 2px 0 0 !important;
  background: #c0c0c0 !important;
  color: #000000 !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #404040 !important;
  border-bottom: none !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="cybercafe-99"] .tab-item *,
[data-theme-skin="cybercafe-99"] [data-tab-id] * {
  color: #000000 !important;
}

[data-theme-skin="cybercafe-99"] .tab-active,
[data-theme-skin="cybercafe-99"] [data-tab-active="true"] {
  background: #c0c0c0 !important;
  color: #000000 !important;
  font-weight: bold !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #404040 !important;
  padding-bottom: 5px !important;
  margin-top: -2px !important;
}

[data-theme-skin="cybercafe-99"] .tab-active *,
[data-theme-skin="cybercafe-99"] [data-tab-active="true"] * {
  color: #000000 !important;
  background: transparent !important;
}

/* Buttons */
[data-theme-skin="cybercafe-99"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #c0c0c0 !important;
  color: #000000 !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #000000 !important;
  border-bottom: 2px solid #000000 !important;
  box-shadow: inset 1px 1px 0 #dfdfdf, inset -1px -1px 0 #808080 !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 12px !important;
}

[data-theme-skin="cybercafe-99"] button:not(.window-control-button) * {
  color: #000000 !important;
}

[data-theme-skin="cybercafe-99"] button:not(.window-control-button):active {
  border-top: 2px solid #000000 !important;
  border-left: 2px solid #000000 !important;
  border-right: 2px solid #ffffff !important;
  border-bottom: 2px solid #ffffff !important;
}

/* Footer & Status Bar */
[data-theme-skin="cybercafe-99"] footer,
[data-theme-skin="cybercafe-99"] .status-bar {
  background: #c0c0c0 !important;
  color: #000000 !important;
  border-top: 1px solid #ffffff !important;
  box-shadow: inset 0 1px 0 #808080 !important;
}

[data-theme-skin="cybercafe-99"] footer *,
[data-theme-skin="cybercafe-99"] .status-bar * {
  color: #000000 !important;
}

/* Breadcrumbs */
[data-theme-skin="cybercafe-99"] [data-slot="breadcrumb"] *,
[data-theme-skin="cybercafe-99"] [data-slot="breadcrumb-item"] * {
  color: #000000 !important;
}

/* Modals & Dialogs */
[data-theme-skin="cybercafe-99"] [role="dialog"] {
  background: #c0c0c0 !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #000000 !important;
  border-bottom: 2px solid #000000 !important;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.4) !important;
}

[data-theme-skin="cybercafe-99"] [role="dialog"] * {
  color: #000000 !important;
}

/* Inputs */
[data-theme-skin="cybercafe-99"] input,
[data-theme-skin="cybercafe-99"] textarea,
[data-theme-skin="cybercafe-99"] select {
  background: #ffffff !important;
  color: #000000 !important;
  border-top: 2px solid #808080 !important;
  border-left: 2px solid #808080 !important;
  border-right: 2px solid #ffffff !important;
  border-bottom: 2px solid #ffffff !important;
  border-radius: 0 !important;
}
`;

export const cyberCafe99Skin: ThemeSkin = {
  id: "cybercafe-99",
  name: "CyberCafe 99",
  author: "Voktty Team",
  description: "Nostalgic 1999 internet café with Windows 98 dial-up teal, desktop shortcuts and retro web aesthetics",
  windowCorners: "square",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "0px",
    borderWidth: "2px",
    borderStyle: "solid",
    focusStyle: "dotted",
    uiFontSmoothing: "antialiased",
    density: "compact",
  },
  css: CYBER_CAFE_99_SKIN_CSS,
};
