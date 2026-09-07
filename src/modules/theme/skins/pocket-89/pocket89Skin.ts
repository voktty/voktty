import type { ThemeSkin } from "../../types";

/**
 * Pocket Handheld 89 Skin
 *
 * Scoped CSS reproducing the iconic 4-tone pea-soup LCD handheld:
 * - Authentic 4 shades of greenish LCD (#9bbc0f, #8bac0f, #306230, #0f380f)
 * - Sharp pixel-perfect borders and square corners
 * - Retro gaming typography with maximum contrast ink
 * - D-pad and action button layout cues
 */
export const POCKET_89_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="pocket-89"] header,
[data-theme-skin="pocket-89"] .title-bar {
  background: #306230 !important;
  color: #9bbc0f !important;
  font-family: 'Courier New', monospace !important;
  font-weight: bold !important;
  border-bottom: 2px solid #0f380f !important;
  padding: 3px 8px !important;
}

[data-theme-skin="pocket-89"] .window-title {
  color: #9bbc0f !important;
  font-family: 'Courier New', monospace !important;
  letter-spacing: 1px !important;
}

/* Window Controls (Square Pixel Buttons) */
[data-theme-skin="pocket-89"] .window-controls {
  gap: 3px !important;
}

[data-theme-skin="pocket-89"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 0 !important;
  background: #8bac0f !important;
  color: #0f380f !important;
  border: 1px solid #0f380f !important;
  font-family: monospace !important;
  font-weight: bold !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="pocket-89"] .window-control-button * {
  color: #0f380f !important;
}

[data-theme-skin="pocket-89"] .window-control-button:hover {
  background: #9bbc0f !important;
}

[data-theme-skin="pocket-89"] .window-control-button-close:hover {
  background: #0f380f !important;
  color: #9bbc0f !important;
}

[data-theme-skin="pocket-89"] .window-control-button-close:hover * {
  color: #9bbc0f !important;
}

/* Tabs: Handheld Cartridge Tabs */
[data-theme-skin="pocket-89"] .tab-item,
[data-theme-skin="pocket-89"] [data-tab-id] {
  border-radius: 0 !important;
  background: #8bac0f !important;
  color: #0f380f !important;
  border: 1px solid #0f380f !important;
  font-family: 'Courier New', monospace !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="pocket-89"] .tab-item *,
[data-theme-skin="pocket-89"] [data-tab-id] * {
  color: #0f380f !important;
}

[data-theme-skin="pocket-89"] .tab-active,
[data-theme-skin="pocket-89"] [data-tab-active="true"] {
  background: #9bbc0f !important;
  color: #0f380f !important;
  border-color: #0f380f !important;
  font-weight: bold !important;
}

[data-theme-skin="pocket-89"] .tab-active *,
[data-theme-skin="pocket-89"] [data-tab-active="true"] * {
  color: #0f380f !important;
  background: transparent !important;
}

/* Buttons (A/B Round Bevel Style) */
[data-theme-skin="pocket-89"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #8bac0f !important;
  color: #0f380f !important;
  border: 2px solid #0f380f !important;
  font-family: 'Courier New', monospace !important;
  font-weight: bold !important;
  padding: 4px 12px !important;
  box-shadow: 2px 2px 0px #0f380f !important;
}

[data-theme-skin="pocket-89"] button:not(.window-control-button) * {
  color: #0f380f !important;
}

[data-theme-skin="pocket-89"] button:not(.window-control-button):hover {
  background: #9bbc0f !important;
}

[data-theme-skin="pocket-89"] button:not(.window-control-button):active {
  box-shadow: none !important;
  transform: translate(2px, 2px) !important;
}

/* Footer & Status Bar */
[data-theme-skin="pocket-89"] footer,
[data-theme-skin="pocket-89"] .status-bar {
  background: #306230 !important;
  color: #9bbc0f !important;
  border-top: 2px solid #0f380f !important;
  font-family: 'Courier New', monospace !important;
}

[data-theme-skin="pocket-89"] footer *,
[data-theme-skin="pocket-89"] .status-bar * {
  color: #9bbc0f !important;
}

/* Breadcrumbs */
[data-theme-skin="pocket-89"] [data-slot="breadcrumb"] *,
[data-theme-skin="pocket-89"] [data-slot="breadcrumb-item"] * {
  color: #0f380f !important;
}

/* Modals & Dialogs */
[data-theme-skin="pocket-89"] [role="dialog"] {
  background: #9bbc0f !important;
  border: 3px solid #0f380f !important;
  box-shadow: 4px 4px 0px #0f380f !important;
}

[data-theme-skin="pocket-89"] [role="dialog"] * {
  color: #0f380f !important;
}

/* Inputs */
[data-theme-skin="pocket-89"] input,
[data-theme-skin="pocket-89"] textarea,
[data-theme-skin="pocket-89"] select {
  background: #9bbc0f !important;
  color: #0f380f !important;
  border: 2px solid #0f380f !important;
  border-radius: 0 !important;
  font-family: 'Courier New', monospace !important;
}
`;

export const pocket89Skin: ThemeSkin = {
  id: "pocket-89",
  name: "Pocket Handheld 89",
  author: "Voktty Team",
  description: "Authentic 4-tone greenish pea-soup LCD handheld with pixel contrast and retro gaming nostalgia",
  windowCorners: "square",
  structuralTraits: {
    elevationStyle: "flat",
    pillRadius: "0px",
    borderWidth: "2px",
    borderStyle: "solid",
    focusStyle: "dotted",
    uiFontSmoothing: "none",
    density: "compact",
  },
  css: POCKET_89_SKIN_CSS,
};
