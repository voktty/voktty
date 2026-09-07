import type { ThemeSkin } from "../../types";

/**
 * BBS Dial-Up Skin
 *
 * Scoped CSS reproducing the 1980s ANSI / ASCII Bulletin Board System aesthetic:
 * - Monospace character-cell typography with sharp 0px corners
 * - High-contrast ANSI colored header bars and double-border frames
 * - Tactile rectangular terminal buttons and bracketed menu item styling
 * - Crisp text contrast with zero blur
 */
export const BBS_DIALUP_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="bbs-dialup"] header,
[data-theme-skin="bbs-dialup"] .title-bar {
  background: #0000aa !important;
  color: #ffffff !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  font-weight: bold !important;
  border-bottom: 2px solid #55ffff !important;
  padding: 2px 6px !important;
}

[data-theme-skin="bbs-dialup"] .window-title {
  color: #ffffff !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  font-weight: bold !important;
  letter-spacing: 1px !important;
}

[data-theme-skin="bbs-dialup"] .window-title::before {
  content: "[ BBS ] " !important;
  color: #ffff55 !important;
}

/* Window Controls (ASCII style bracketed [ - ] [ + ] [ X ]) */
[data-theme-skin="bbs-dialup"] .window-controls {
  gap: 2px !important;
}

[data-theme-skin="bbs-dialup"] .window-control-button {
  width: 20px !important;
  height: 20px !important;
  min-width: 20px !important;
  border-radius: 0 !important;
  background: #000080 !important;
  color: #ffff55 !important;
  border: 1px solid #55ffff !important;
  font-family: 'Consolas', monospace !important;
  font-weight: bold !important;
  font-size: 11px !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="bbs-dialup"] .window-control-button * {
  color: #ffff55 !important;
}

[data-theme-skin="bbs-dialup"] .window-control-button:hover {
  background: #ffff55 !important;
  color: #000000 !important;
  border-color: #ffffff !important;
}

[data-theme-skin="bbs-dialup"] .window-control-button:hover * {
  color: #000000 !important;
}

[data-theme-skin="bbs-dialup"] .window-control-button-close:hover {
  background: #aa0000 !important;
  color: #ffffff !important;
  border-color: #ff5555 !important;
}

[data-theme-skin="bbs-dialup"] .window-control-button-close:hover * {
  color: #ffffff !important;
}

/* Tabs: ASCII Bracket Tabs */
[data-theme-skin="bbs-dialup"] .tab-item,
[data-theme-skin="bbs-dialup"] [data-tab-id] {
  border-radius: 0 !important;
  background: #000055 !important;
  color: #aaaaaa !important;
  border: 1px solid #555555 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  font-size: 12px !important;
  margin-right: 2px !important;
  padding: 2px 8px !important;
}

[data-theme-skin="bbs-dialup"] .tab-item *,
[data-theme-skin="bbs-dialup"] [data-tab-id] * {
  color: #aaaaaa !important;
}

[data-theme-skin="bbs-dialup"] .tab-active,
[data-theme-skin="bbs-dialup"] [data-tab-active="true"] {
  background: #00aaaa !important;
  color: #000000 !important;
  border-color: #55ffff !important;
  font-weight: bold !important;
}

[data-theme-skin="bbs-dialup"] .tab-active *,
[data-theme-skin="bbs-dialup"] [data-tab-active="true"] * {
  color: #000000 !important;
  background: transparent !important;
}

/* Buttons (ANSI ASCII Menu Buttons) */
[data-theme-skin="bbs-dialup"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #000080 !important;
  color: #ffff55 !important;
  border: 1px solid #55ffff !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  font-size: 12px !important;
  font-weight: bold !important;
  padding: 3px 10px !important;
}

[data-theme-skin="bbs-dialup"] button:not(.window-control-button) * {
  color: #ffff55 !important;
}

[data-theme-skin="bbs-dialup"] button:not(.window-control-button):hover {
  background: #55ffff !important;
  color: #000000 !important;
}

[data-theme-skin="bbs-dialup"] button:not(.window-control-button):hover * {
  color: #000000 !important;
}

/* Footer & Status Bar */
[data-theme-skin="bbs-dialup"] footer,
[data-theme-skin="bbs-dialup"] .status-bar {
  background: #000055 !important;
  color: #00ff55 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  border-top: 1px solid #00aaaa !important;
}

[data-theme-skin="bbs-dialup"] footer *,
[data-theme-skin="bbs-dialup"] .status-bar * {
  color: #00ff55 !important;
}

/* Breadcrumbs */
[data-theme-skin="bbs-dialup"] [data-slot="breadcrumb"] *,
[data-theme-skin="bbs-dialup"] [data-slot="breadcrumb-item"] * {
  color: #ffff55 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
}

/* Modals & Dialogs */
[data-theme-skin="bbs-dialup"] [role="dialog"] {
  background: #0000aa !important;
  border: 2px solid #ffffff !important;
  border-radius: 0 !important;
  font-family: 'Consolas', monospace !important;
}

[data-theme-skin="bbs-dialup"] [role="dialog"] * {
  color: #ffffff !important;
}

/* Inputs */
[data-theme-skin="bbs-dialup"] input,
[data-theme-skin="bbs-dialup"] textarea,
[data-theme-skin="bbs-dialup"] select {
  background: #000000 !important;
  color: #55ff55 !important;
  border: 1px solid #55ffff !important;
  border-radius: 0 !important;
  font-family: 'Consolas', monospace !important;
}
`;

export const bbsDialupSkin: ThemeSkin = {
  id: "bbs-dialup",
  name: "BBS Dial-Up",
  author: "Voktty Team",
  description: "1980s bulletin board system with ANSI character cell blocks, ASCII menus and telephone modem telemetry colors",
  windowCorners: "square",
  structuralTraits: {
    elevationStyle: "flat",
    pillRadius: "0px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "none",
    density: "compact",
  },
  css: BBS_DIALUP_SKIN_CSS,
};
