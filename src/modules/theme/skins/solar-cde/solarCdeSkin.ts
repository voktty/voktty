import type { ThemeSkin } from "../../types";

/**
 * Solar Workstation Skin
 *
 * Scoped CSS reproducing the Common Desktop Environment (CDE) Unix workstation:
 * - Geometric recessed 3D front panels in slate steel (#546376)
 * - Beveled terracotta primary action buttons (#a86c4a)
 * - Inset sunken title label with high contrast white text
 * - Authentic Unix enterprise workstation layout and beveled gadgets
 */
export const SOLAR_CDE_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="solar-cde"] header,
[data-theme-skin="solar-cde"] .title-bar {
  background: #4a5768 !important;
  color: #ffffff !important;
  font-family: 'Helvetica', Arial, sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #20262e !important;
  box-shadow: inset 1px 1px 0 #6e7e94, inset -1px -1px 0 #2e3642 !important;
  padding: 3px 8px !important;
}

[data-theme-skin="solar-cde"] .window-title {
  color: #ffffff !important;
  font-family: 'Helvetica', Arial, sans-serif !important;
  letter-spacing: 0.5px !important;
}

/* Window Controls (Beveled CDE Gadgets) */
[data-theme-skin="solar-cde"] .window-controls {
  gap: 3px !important;
}

[data-theme-skin="solar-cde"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 0 !important;
  background: #546376 !important;
  color: #ffffff !important;
  border: 1px solid #28303a !important;
  box-shadow: inset 1px 1px 0 #7c8e9e, inset -1px -1px 0 #323c48 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="solar-cde"] .window-control-button * {
  color: #ffffff !important;
}

[data-theme-skin="solar-cde"] .window-control-button:hover {
  background: #64758a !important;
}

[data-theme-skin="solar-cde"] .window-control-button-close:hover {
  background: #9c382b !important;
}

/* Tabs: CDE Sunken Tabs */
[data-theme-skin="solar-cde"] .tab-item,
[data-theme-skin="solar-cde"] [data-tab-id] {
  border-radius: 0 !important;
  background: #3e4956 !important;
  color: #c4d0df !important;
  border: 1px solid #20262e !important;
  box-shadow: inset 1px 1px 0 #58687a, inset -1px -1px 0 #28303a !important;
  font-family: 'Helvetica', Arial, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="solar-cde"] .tab-item *,
[data-theme-skin="solar-cde"] [data-tab-id] * {
  color: #c4d0df !important;
}

[data-theme-skin="solar-cde"] .tab-active,
[data-theme-skin="solar-cde"] [data-tab-active="true"] {
  background: #546376 !important;
  color: #ffffff !important;
  border-color: #20262e !important;
  box-shadow: inset 1px 1px 0 #8090a2, inset -1px -1px 0 #343f4c !important;
  font-weight: bold !important;
}

[data-theme-skin="solar-cde"] .tab-active *,
[data-theme-skin="solar-cde"] [data-tab-active="true"] * {
  color: #ffffff !important;
  background: transparent !important;
}

/* Buttons (CDE Beveled Buttons) */
[data-theme-skin="solar-cde"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #546376 !important;
  color: #ffffff !important;
  border: 1px solid #222830 !important;
  box-shadow: inset 1px 1px 0 #7a8c9e, inset -1px -1px 0 #323b46 !important;
  font-family: 'Helvetica', Arial, sans-serif !important;
  font-weight: bold !important;
  padding: 4px 12px !important;
}

[data-theme-skin="solar-cde"] button:not(.window-control-button) * {
  color: #ffffff !important;
}

[data-theme-skin="solar-cde"] button:not(.window-control-button):hover {
  background: #627286 !important;
}

[data-theme-skin="solar-cde"] button:not(.window-control-button):active {
  box-shadow: inset 1px 1px 0 #20262e, inset -1px -1px 0 #7a8c9e !important;
}

/* Footer & Status Bar */
[data-theme-skin="solar-cde"] footer,
[data-theme-skin="solar-cde"] .status-bar {
  background: #343d48 !important;
  color: #d4e0ee !important;
  border-top: 1px solid #20262e !important;
}

[data-theme-skin="solar-cde"] footer *,
[data-theme-skin="solar-cde"] .status-bar * {
  color: #d4e0ee !important;
}

/* Breadcrumbs */
[data-theme-skin="solar-cde"] [data-slot="breadcrumb"] *,
[data-theme-skin="solar-cde"] [data-slot="breadcrumb-item"] * {
  color: #d4e0ee !important;
}

/* Modals & Dialogs */
[data-theme-skin="solar-cde"] [role="dialog"] {
  background: #4a5768 !important;
  border: 2px solid #20262e !important;
  box-shadow: inset 1px 1px 0 #728298, inset -1px -1px 0 #28303a, 6px 6px 0px rgba(0, 0, 0, 0.6) !important;
}

[data-theme-skin="solar-cde"] [role="dialog"] * {
  color: #ffffff !important;
}

/* Inputs */
[data-theme-skin="solar-cde"] input,
[data-theme-skin="solar-cde"] textarea,
[data-theme-skin="solar-cde"] select {
  background: #2b333c !important;
  color: #ffffff !important;
  border: 1px solid #1c2228 !important;
  box-shadow: inset 1px 1px 2px #101418 !important;
  border-radius: 0 !important;
}
`;

export const solarCdeSkin: ThemeSkin = {
  id: "solar-cde",
  name: "Solar Workstation",
  author: "Voktty Team",
  description: "Common Desktop Environment enterprise Unix workstation with geometric panels, deep slate and plum accents",
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
  css: SOLAR_CDE_SKIN_CSS,
};
