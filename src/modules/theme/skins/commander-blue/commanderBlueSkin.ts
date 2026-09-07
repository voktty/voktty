import type { ThemeSkin } from "../../types";

/**
 * Commander Blue Skin
 *
 * Scoped CSS and structural traits reproducing classic DOS dual-pane file commander:
 * - Deep navy header with cyan border and bright yellow title
 * - Square bracket DOS controls: [─], [▲], [×]
 * - Monospace typography with crisp box borders
 * - F1-F10 function key bar layout in footer
 * - High-contrast text: yellow/white on navy, no washed-out grays
 */
export const COMMANDER_BLUE_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="commander-blue"] header,
[data-theme-skin="commander-blue"] .title-bar {
  background: #0000a8 !important;
  color: #ffff55 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  font-weight: bold !important;
  border-bottom: 2px solid #00aaaa !important;
  padding: 3px 8px !important;
  box-shadow: inset 0 -1px 0 #55ffff !important;
}

[data-theme-skin="commander-blue"] .window-title {
  color: #ffff55 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  letter-spacing: 0.5px !important;
}

/* Window Controls (DOS Bracket Style) */
[data-theme-skin="commander-blue"] .window-controls {
  gap: 4px !important;
}

[data-theme-skin="commander-blue"] .window-control-button {
  width: 20px !important;
  height: 20px !important;
  min-width: 20px !important;
  border-radius: 0 !important;
  background: #000080 !important;
  color: #55ffff !important;
  border: 1px solid #00aaaa !important;
  font-family: monospace !important;
  font-weight: bold !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="commander-blue"] .window-control-button * {
  color: #55ffff !important;
}

[data-theme-skin="commander-blue"] .window-control-button:hover {
  background: #00aaaa !important;
  color: #000080 !important;
}

[data-theme-skin="commander-blue"] .window-control-button:hover * {
  color: #000080 !important;
}

[data-theme-skin="commander-blue"] .window-control-button-close:hover {
  background: #aa0000 !important;
  color: #ffffff !important;
}

[data-theme-skin="commander-blue"] .window-control-button-close:hover * {
  color: #ffffff !important;
}

/* Tabs: Dual-Pane Commander Style */
[data-theme-skin="commander-blue"] .tab-item,
[data-theme-skin="commander-blue"] [data-tab-id] {
  border-radius: 0 !important;
  background: #000080 !important;
  color: #00aaaa !important;
  border: 1px solid #00aaaa !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  margin-right: 2px !important;
  padding: 3px 8px !important;
}

[data-theme-skin="commander-blue"] .tab-item *,
[data-theme-skin="commander-blue"] [data-tab-id] * {
  color: #55ffff !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
}

[data-theme-skin="commander-blue"] .tab-active,
[data-theme-skin="commander-blue"] [data-tab-active="true"] {
  background: #00aaaa !important;
  color: #000080 !important;
  border-color: #55ffff !important;
  font-weight: bold !important;
}

[data-theme-skin="commander-blue"] .tab-active *,
[data-theme-skin="commander-blue"] [data-tab-active="true"] * {
  color: #000080 !important;
  background: transparent !important;
}

/* Buttons (DOS Function Keys Look) */
[data-theme-skin="commander-blue"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #0000a8 !important;
  color: #ffffff !important;
  border: 1px solid #00aaaa !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  font-weight: bold !important;
  padding: 4px 10px !important;
}

[data-theme-skin="commander-blue"] button:not(.window-control-button) * {
  color: #ffffff !important;
}

[data-theme-skin="commander-blue"] button:not(.window-control-button):hover {
  background: #00aaaa !important;
  color: #000000 !important;
}

[data-theme-skin="commander-blue"] button:not(.window-control-button):hover * {
  color: #000000 !important;
}

/* Footer / Status Bar (DOS Function Key Bar) */
[data-theme-skin="commander-blue"] footer,
[data-theme-skin="commander-blue"] .status-bar {
  background: #000000 !important;
  color: #ffffff !important;
  border-top: 1px solid #00aaaa !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
}

[data-theme-skin="commander-blue"] footer *,
[data-theme-skin="commander-blue"] .status-bar * {
  color: #55ffff !important;
}

/* Breadcrumbs */
[data-theme-skin="commander-blue"] [data-slot="breadcrumb"] *,
[data-theme-skin="commander-blue"] [data-slot="breadcrumb-item"] * {
  color: #ffff55 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
}

/* Modals & Dialogs */
[data-theme-skin="commander-blue"] [role="dialog"] {
  background: #0000a8 !important;
  border: 2px solid #55ffff !important;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.7) !important;
}

[data-theme-skin="commander-blue"] [role="dialog"] * {
  color: #ffffff !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
}

[data-theme-skin="commander-blue"] [role="dialog"] h1,
[data-theme-skin="commander-blue"] [role="dialog"] h2,
[data-theme-skin="commander-blue"] [role="dialog"] h3 {
  color: #ffff55 !important;
}

/* Inputs */
[data-theme-skin="commander-blue"] input,
[data-theme-skin="commander-blue"] textarea,
[data-theme-skin="commander-blue"] select {
  background: #000055 !important;
  color: #ffff55 !important;
  border: 1px solid #00aaaa !important;
  border-radius: 0 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
}
`;

export const commanderBlueSkin: ThemeSkin = {
  id: "commander-blue",
  name: "Commander Blue",
  author: "Voktty Team",
  description: "Classic DOS dual-pane file commander with deep navy background, cyan borders and yellow accents",
  windowCorners: "square",
  structuralTraits: {
    elevationStyle: "flat",
    pillRadius: "0px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "dotted",
    uiFontSmoothing: "none",
    density: "compact",
  },
  css: COMMANDER_BLUE_SKIN_CSS,
};
