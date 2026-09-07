import type { ThemeSkin } from "../../types";

/**
 * YellowTab OS Skin
 *
 * Scoped CSS reproducing the iconic BeOS responsive desktop:
 * - Signature sunshine yellow tab window header (#ffd700) with crisp black text
 * - Clean metallic slate blue-gray desktop chrome (#d0d6dc)
 * - Inset 3D window frames and square toggle gadgets
 * - High legibility: black text on yellow/white surfaces
 */
export const YELLOW_TAB_OS_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="yellowtab-os"] header,
[data-theme-skin="yellowtab-os"] .title-bar {
  background: #d0d6dc !important;
  color: #000000 !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
  border-bottom: 1px solid #8492a0 !important;
  padding: 0 !important;
  display: flex !important;
  align-items: center !important;
}

/* Signature BeOS Yellow Tab Header */
[data-theme-skin="yellowtab-os"] .window-title {
  background: #ffd700 !important;
  color: #000000 !important;
  font-weight: bold !important;
  padding: 4px 14px !important;
  border: 1px solid #8492a0 !important;
  border-bottom: none !important;
  border-radius: 4px 4px 0 0 !important;
  box-shadow: inset 1px 1px 0 #fff5a0, inset -1px 0 0 #d4b000 !important;
}

/* Window Controls */
[data-theme-skin="yellowtab-os"] .window-controls {
  gap: 3px !important;
  padding-right: 6px !important;
  margin-left: auto !important;
}

[data-theme-skin="yellowtab-os"] .window-control-button {
  width: 17px !important;
  height: 17px !important;
  min-width: 17px !important;
  border-radius: 2px !important;
  background: #d0d6dc !important;
  color: #000000 !important;
  border: 1px solid #728090 !important;
  box-shadow: inset 1px 1px 0 #ffffff, inset -1px -1px 0 #9ca8b4 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="yellowtab-os"] .window-control-button * {
  color: #000000 !important;
}

[data-theme-skin="yellowtab-os"] .window-control-button:hover {
  background: #ffd700 !important;
}

[data-theme-skin="yellowtab-os"] .window-control-button-close:hover {
  background: #e04040 !important;
  color: #ffffff !important;
}

[data-theme-skin="yellowtab-os"] .window-control-button-close:hover * {
  color: #ffffff !important;
}

/* Tabs: YellowTab OS Drawer Tabs */
[data-theme-skin="yellowtab-os"] .tab-item,
[data-theme-skin="yellowtab-os"] [data-tab-id] {
  border-radius: 3px 3px 0 0 !important;
  background: #bcc4cc !important;
  color: #000000 !important;
  border: 1px solid #8492a0 !important;
  border-bottom: none !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="yellowtab-os"] .tab-item *,
[data-theme-skin="yellowtab-os"] [data-tab-id] * {
  color: #000000 !important;
}

[data-theme-skin="yellowtab-os"] .tab-active,
[data-theme-skin="yellowtab-os"] [data-tab-active="true"] {
  background: #ffd700 !important;
  color: #000000 !important;
  border-color: #8492a0 !important;
  box-shadow: inset 1px 1px 0 #fff5a0 !important;
  font-weight: bold !important;
}

[data-theme-skin="yellowtab-os"] .tab-active *,
[data-theme-skin="yellowtab-os"] [data-tab-active="true"] * {
  color: #000000 !important;
  background: transparent !important;
}

/* Buttons */
[data-theme-skin="yellowtab-os"] button:not(.window-control-button) {
  border-radius: 2px !important;
  background: #d0d6dc !important;
  color: #000000 !important;
  border: 1px solid #728090 !important;
  box-shadow: inset 1px 1px 0 #ffffff, inset -1px -1px 0 #9ca8b4 !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 12px !important;
}

[data-theme-skin="yellowtab-os"] button:not(.window-control-button) * {
  color: #000000 !important;
}

[data-theme-skin="yellowtab-os"] button:not(.window-control-button):hover {
  background: #e0e6ec !important;
  border-color: #336699 !important;
}

[data-theme-skin="yellowtab-os"] button:not(.window-control-button):active {
  background: #bcc4cc !important;
  box-shadow: inset 1px 1px 1px #647080 !important;
}

/* Footer & Status Bar */
[data-theme-skin="yellowtab-os"] footer,
[data-theme-skin="yellowtab-os"] .status-bar {
  background: #d0d6dc !important;
  color: #000000 !important;
  border-top: 1px solid #8492a0 !important;
}

[data-theme-skin="yellowtab-os"] footer *,
[data-theme-skin="yellowtab-os"] .status-bar * {
  color: #000000 !important;
}

/* Breadcrumbs */
[data-theme-skin="yellowtab-os"] [data-slot="breadcrumb"] *,
[data-theme-skin="yellowtab-os"] [data-slot="breadcrumb-item"] * {
  color: #000000 !important;
}

/* Modals & Dialogs */
[data-theme-skin="yellowtab-os"] [role="dialog"] {
  background: #ffffff !important;
  border: 1px solid #8492a0 !important;
  box-shadow: 4px 4px 16px rgba(0, 0, 0, 0.25) !important;
}

[data-theme-skin="yellowtab-os"] [role="dialog"] * {
  color: #000000 !important;
}

/* Inputs */
[data-theme-skin="yellowtab-os"] input,
[data-theme-skin="yellowtab-os"] textarea,
[data-theme-skin="yellowtab-os"] select {
  background: #ffffff !important;
  color: #000000 !important;
  border: 1px solid #728090 !important;
  border-radius: 2px !important;
}
`;

export const yellowTabOsSkin: ThemeSkin = {
  id: "yellowtab-os",
  name: "YellowTab OS",
  author: "Voktty Team",
  description: "Legendary responsive desktop with signature yellow-tab window titles and clean blue-gray chrome",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "2px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "comfortable",
  },
  css: YELLOW_TAB_OS_SKIN_CSS,
};
