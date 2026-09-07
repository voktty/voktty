import type { ThemeSkin } from "../../types";

/**
 * CubeStep Skin
 *
 * Scoped CSS reproducing the iconic NeXTSTEP black workstation GUI:
 * - Matte dark titanium surfaces (#2b2c30) with 3D beveled borders
 * - Beveled rectangular buttons with heavy 2px inset/outset contrast
 * - High-contrast white and light-gray typography
 * - Crisp floating window titlebar and square dark dock-tile feel
 */
export const CUBE_STEP_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="cubestep"] header,
[data-theme-skin="cubestep"] .title-bar {
  background: #36383e !important;
  color: #ffffff !important;
  font-family: 'Helvetica Neue', Arial, sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #1a1b1d !important;
  box-shadow: inset 0 1px 0 #52555e, inset 0 -1px 0 #202124 !important;
  padding: 3px 8px !important;
}

[data-theme-skin="cubestep"] .window-title {
  color: #ffffff !important;
  font-family: 'Helvetica Neue', Arial, sans-serif !important;
  letter-spacing: 0.5px !important;
}

/* Window Controls (3D Beveled Square Tiles) */
[data-theme-skin="cubestep"] .window-controls {
  gap: 3px !important;
}

[data-theme-skin="cubestep"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 0 !important;
  background: #44474f !important;
  color: #ffffff !important;
  border: 1px solid #1c1d20 !important;
  box-shadow: inset 1px 1px 0 #686c77, inset -1px -1px 0 #282a2e !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="cubestep"] .window-control-button * {
  color: #ffffff !important;
}

[data-theme-skin="cubestep"] .window-control-button:hover {
  background: #565a63 !important;
}

[data-theme-skin="cubestep"] .window-control-button-close:hover {
  background: #8b2525 !important;
}

/* Tabs: 3D Beveled Document Tiles */
[data-theme-skin="cubestep"] .tab-item,
[data-theme-skin="cubestep"] [data-tab-id] {
  border-radius: 0 !important;
  background: #25262a !important;
  color: #c0c4cc !important;
  border: 1px solid #151618 !important;
  box-shadow: inset 1px 1px 0 #3a3c42, inset -1px -1px 0 #121315 !important;
  font-family: 'Helvetica Neue', Arial, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="cubestep"] .tab-item *,
[data-theme-skin="cubestep"] [data-tab-id] * {
  color: #c0c4cc !important;
}

[data-theme-skin="cubestep"] .tab-active,
[data-theme-skin="cubestep"] [data-tab-active="true"] {
  background: #44474f !important;
  color: #ffffff !important;
  border-color: #151618 !important;
  box-shadow: inset 1px 1px 0 #727682, inset -1px -1px 0 #222327 !important;
  font-weight: bold !important;
}

[data-theme-skin="cubestep"] .tab-active *,
[data-theme-skin="cubestep"] [data-tab-active="true"] * {
  color: #ffffff !important;
  background: transparent !important;
}

/* Buttons (NeXT 3D Heavy Bevel Buttons) */
[data-theme-skin="cubestep"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #44474f !important;
  color: #ffffff !important;
  border: 1px solid #151618 !important;
  box-shadow: inset 1px 1px 0 #6d717d, inset -1px -1px 0 #25262a !important;
  font-family: 'Helvetica Neue', Arial, sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 12px !important;
}

[data-theme-skin="cubestep"] button:not(.window-control-button) * {
  color: #ffffff !important;
}

[data-theme-skin="cubestep"] button:not(.window-control-button):hover {
  background: #545761 !important;
}

[data-theme-skin="cubestep"] button:not(.window-control-button):active {
  box-shadow: inset 1px 1px 0 #151618, inset -1px -1px 0 #5a5d66 !important;
}

/* Footer & Status Bar */
[data-theme-skin="cubestep"] footer,
[data-theme-skin="cubestep"] .status-bar {
  background: #202124 !important;
  color: #d0d4dc !important;
  border-top: 1px solid #141517 !important;
}

[data-theme-skin="cubestep"] footer *,
[data-theme-skin="cubestep"] .status-bar * {
  color: #d0d4dc !important;
}

/* Breadcrumbs */
[data-theme-skin="cubestep"] [data-slot="breadcrumb"] *,
[data-theme-skin="cubestep"] [data-slot="breadcrumb-item"] * {
  color: #d0d4dc !important;
}

/* Modals & Dialogs */
[data-theme-skin="cubestep"] [role="dialog"] {
  background: #2b2c30 !important;
  border: 2px solid #151618 !important;
  box-shadow: inset 1px 1px 0 #4f525c, inset -1px -1px 0 #1a1b1d, 8px 8px 0px rgba(0, 0, 0, 0.7) !important;
}

[data-theme-skin="cubestep"] [role="dialog"] * {
  color: #ffffff !important;
}

/* Inputs */
[data-theme-skin="cubestep"] input,
[data-theme-skin="cubestep"] textarea,
[data-theme-skin="cubestep"] select {
  background: #1e1f22 !important;
  color: #ffffff !important;
  border: 1px solid #121314 !important;
  box-shadow: inset 1px 1px 2px #0a0b0c !important;
  border-radius: 0 !important;
}
`;

export const cubeStepSkin: ThemeSkin = {
  id: "cubestep",
  name: "CubeStep",
  author: "Voktty Team",
  description: "Iconic black cube workstation with 3D beveled dark titanium tiles, floating titlebars and high-contrast typography",
  windowCorners: "square",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "0px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "compact",
  },
  css: CUBE_STEP_SKIN_CSS,
};
