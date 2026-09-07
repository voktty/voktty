import type { ThemeSkin } from "../../types";

/**
 * Boing Workbench Skin
 *
 * Scoped CSS reproducing the legendary 1985 creative computing desktop:
 * - Signature royal sapphire blue canvas (#0055aa)
 * - White header titlebar with crisp black typography
 * - Topaz amber orange highlights (#ff8800)
 * - 4-color high-contrast pixelated window borders
 * - Classic square box gadget window controls
 */
export const BOING_WORKBENCH_SKIN_CSS = `
/* Window Chrome & Header (Top Menu Bar Look) */
[data-theme-skin="boing-workbench"] header,
[data-theme-skin="boing-workbench"] .title-bar {
  background: #ffffff !important;
  color: #000000 !important;
  font-family: 'Topaz', 'Consolas', 'Courier New', monospace !important;
  font-weight: bold !important;
  border-bottom: 2px solid #000000 !important;
  padding: 3px 8px !important;
  box-shadow: 0 1px 0 #0055aa !important;
}

[data-theme-skin="boing-workbench"] .window-title {
  color: #000000 !important;
  font-family: 'Topaz', 'Consolas', 'Courier New', monospace !important;
}

/* Window Controls (Square Box Gadgets) */
[data-theme-skin="boing-workbench"] .window-controls {
  gap: 4px !important;
}

[data-theme-skin="boing-workbench"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  border: 2px solid #000000 !important;
  font-family: monospace !important;
  font-weight: bold !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="boing-workbench"] .window-control-button * {
  color: #000000 !important;
}

[data-theme-skin="boing-workbench"] .window-control-button:hover {
  background: #ff8800 !important;
  color: #000000 !important;
}

[data-theme-skin="boing-workbench"] .window-control-button:hover * {
  color: #000000 !important;
}

/* Tabs: Workbench Drawer Tabs */
[data-theme-skin="boing-workbench"] .tab-item,
[data-theme-skin="boing-workbench"] [data-tab-id] {
  border-radius: 0 !important;
  background: #004488 !important;
  color: #ffffff !important;
  border: 2px solid #000000 !important;
  font-family: 'Consolas', monospace !important;
  margin-right: 2px !important;
  padding: 3px 8px !important;
}

[data-theme-skin="boing-workbench"] .tab-item *,
[data-theme-skin="boing-workbench"] [data-tab-id] * {
  color: #ffffff !important;
}

[data-theme-skin="boing-workbench"] .tab-active,
[data-theme-skin="boing-workbench"] [data-tab-active="true"] {
  background: #ff8800 !important;
  color: #000000 !important;
  border-color: #000000 !important;
  font-weight: bold !important;
}

[data-theme-skin="boing-workbench"] .tab-active *,
[data-theme-skin="boing-workbench"] [data-tab-active="true"] * {
  color: #000000 !important;
  background: transparent !important;
}

/* Buttons */
[data-theme-skin="boing-workbench"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  border: 2px solid #000000 !important;
  font-family: 'Consolas', monospace !important;
  font-weight: bold !important;
  padding: 4px 10px !important;
  box-shadow: 2px 2px 0px #000000 !important;
}

[data-theme-skin="boing-workbench"] button:not(.window-control-button) * {
  color: #000000 !important;
}

[data-theme-skin="boing-workbench"] button:not(.window-control-button):hover {
  background: #ff8800 !important;
}

[data-theme-skin="boing-workbench"] button:not(.window-control-button):active {
  box-shadow: none !important;
  transform: translate(2px, 2px) !important;
}

/* Footer & Status Bar */
[data-theme-skin="boing-workbench"] footer,
[data-theme-skin="boing-workbench"] .status-bar {
  background: #ffffff !important;
  color: #000000 !important;
  border-top: 2px solid #000000 !important;
  font-family: 'Consolas', monospace !important;
}

[data-theme-skin="boing-workbench"] footer *,
[data-theme-skin="boing-workbench"] .status-bar * {
  color: #000000 !important;
}

/* Breadcrumbs */
[data-theme-skin="boing-workbench"] [data-slot="breadcrumb"] *,
[data-theme-skin="boing-workbench"] [data-slot="breadcrumb-item"] * {
  color: #000000 !important;
  font-family: 'Consolas', monospace !important;
}

/* Modals & Dialogs */
[data-theme-skin="boing-workbench"] [role="dialog"] {
  background: #0055aa !important;
  border: 3px solid #000000 !important;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.8) !important;
}

[data-theme-skin="boing-workbench"] [role="dialog"] * {
  color: #ffffff !important;
}

[data-theme-skin="boing-workbench"] [role="dialog"] h1,
[data-theme-skin="boing-workbench"] [role="dialog"] h2,
[data-theme-skin="boing-workbench"] [role="dialog"] h3 {
  color: #ff8800 !important;
}

/* Inputs */
[data-theme-skin="boing-workbench"] input,
[data-theme-skin="boing-workbench"] textarea,
[data-theme-skin="boing-workbench"] select {
  background: #ffffff !important;
  color: #000000 !important;
  border: 2px solid #000000 !important;
  border-radius: 0 !important;
  font-family: 'Consolas', monospace !important;
}
`;

export const boingWorkbenchSkin: ThemeSkin = {
  id: "boing-workbench",
  name: "Boing Workbench",
  author: "Voktty Team",
  description: "Legendary 1985 creative workstation with 4-color sapphire blue, amber topaz, crisp white and obsidian",
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
  css: BOING_WORKBENCH_SKIN_CSS,
};
