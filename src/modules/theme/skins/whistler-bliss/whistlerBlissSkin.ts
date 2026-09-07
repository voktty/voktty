import type { ThemeSkin } from "../../types";

/**
 * Whistler Bliss Skin
 *
 * Scoped CSS reproducing the iconic Y2K modern classic desktop:
 * - Signature royal blue curved titlebar with gloss highlight
 * - Crimson red rounded close button and glossy blue min/max buttons
 * - Classic beige-silver dialog surfaces (#ece9d8) with 3D drop bevels
 * - Crisp black typography on all windows, tabs and controls
 * - High legibility: black text on white/beige surfaces, white text on blue header
 */
export const WHISTLER_BLISS_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="whistler-bliss"] header,
[data-theme-skin="whistler-bliss"] .title-bar {
  background: linear-gradient(180deg, #0058ee 0%, #3593ff 12%, #0860ee 50%, #004ecc 100%) !important;
  color: #ffffff !important;
  font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #003399 !important;
  padding: 3px 8px !important;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7) !important;
}

[data-theme-skin="whistler-bliss"] .window-title {
  color: #ffffff !important;
  font-weight: bold !important;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7) !important;
}

/* Window Controls (Glossy Blue & Crimson Red) */
[data-theme-skin="whistler-bliss"] .window-controls {
  gap: 3px !important;
  padding-right: 4px !important;
}

[data-theme-skin="whistler-bliss"] .window-control-button {
  width: 21px !important;
  height: 21px !important;
  min-width: 21px !important;
  border-radius: 3px !important;
  background: linear-gradient(180deg, #428eff 0%, #0055ea 50%, #0040b8 100%) !important;
  color: #ffffff !important;
  border: 1px solid #002d80 !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6) !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="whistler-bliss"] .window-control-button * {
  color: #ffffff !important;
}

[data-theme-skin="whistler-bliss"] .window-control-button:hover {
  background: linear-gradient(180deg, #66aaff 0%, #1a6ff5 50%, #0050d0 100%) !important;
}

/* Close Button: Signature Crimson Red */
[data-theme-skin="whistler-bliss"] .window-control-button-close {
  background: linear-gradient(180deg, #f06050 0%, #d62010 50%, #ad1508 100%) !important;
  border: 1px solid #750d04 !important;
}

[data-theme-skin="whistler-bliss"] .window-control-button-close:hover {
  background: linear-gradient(180deg, #ff7a6b 0%, #eb2f1e 50%, #bf1b0c 100%) !important;
}

/* Tabs: Classic Beige/White Tabs */
[data-theme-skin="whistler-bliss"] .tab-item,
[data-theme-skin="whistler-bliss"] [data-tab-id] {
  border-radius: 4px 4px 0 0 !important;
  background: #d8d4c8 !important;
  color: #000000 !important;
  border: 1px solid #918b7e !important;
  border-bottom: none !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="whistler-bliss"] .tab-item *,
[data-theme-skin="whistler-bliss"] [data-tab-id] * {
  color: #000000 !important;
}

[data-theme-skin="whistler-bliss"] .tab-active,
[data-theme-skin="whistler-bliss"] [data-tab-active="true"] {
  background: #ffffff !important;
  border-color: #0055ea #918b7e #ffffff #918b7e !important;
  border-top: 2px solid #ff7b00 !important;
  font-weight: 600 !important;
}

[data-theme-skin="whistler-bliss"] .tab-active *,
[data-theme-skin="whistler-bliss"] [data-tab-active="true"] * {
  color: #000000 !important;
  background: transparent !important;
}

/* Buttons (Glossy Beveled Windows Buttons) */
[data-theme-skin="whistler-bliss"] button:not(.window-control-button) {
  border-radius: 3px !important;
  background: linear-gradient(180deg, #ffffff 0%, #ece9d8 70%, #dcd6c4 100%) !important;
  color: #000000 !important;
  border: 1px solid #003c74 !important;
  box-shadow: inset 0 1px 0 #ffffff !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
  padding: 4px 12px !important;
}

[data-theme-skin="whistler-bliss"] button:not(.window-control-button) * {
  color: #000000 !important;
}

[data-theme-skin="whistler-bliss"] button:not(.window-control-button):hover {
  border-color: #ff9900 !important;
  box-shadow: inset 0 0 4px #ffcc66 !important;
}

[data-theme-skin="whistler-bliss"] button:not(.window-control-button):active {
  background: linear-gradient(180deg, #cfc9b8 0%, #ece9d8 100%) !important;
}

/* Status Bar & Footer */
[data-theme-skin="whistler-bliss"] footer,
[data-theme-skin="whistler-bliss"] .status-bar {
  background: #ece9d8 !important;
  color: #000000 !important;
  border-top: 1px solid #918b7e !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
}

[data-theme-skin="whistler-bliss"] footer *,
[data-theme-skin="whistler-bliss"] .status-bar * {
  color: #000000 !important;
}

/* Breadcrumbs */
[data-theme-skin="whistler-bliss"] [data-slot="breadcrumb"] *,
[data-theme-skin="whistler-bliss"] [data-slot="breadcrumb-item"] * {
  color: #000000 !important;
  font-family: 'Segoe UI', Tahoma, sans-serif !important;
}

/* Modals & Dialogs */
[data-theme-skin="whistler-bliss"] [role="dialog"] {
  background: #ece9d8 !important;
  border: 1px solid #0055ea !important;
  border-radius: 6px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3) !important;
}

[data-theme-skin="whistler-bliss"] [role="dialog"] * {
  color: #000000 !important;
}

/* Inputs */
[data-theme-skin="whistler-bliss"] input,
[data-theme-skin="whistler-bliss"] textarea,
[data-theme-skin="whistler-bliss"] select {
  background: #ffffff !important;
  color: #000000 !important;
  border: 1px solid #7f9db9 !important;
  border-radius: 2px !important;
}
`;

export const whistlerBlissSkin: ThemeSkin = {
  id: "whistler-bliss",
  name: "Whistler Bliss",
  author: "Voktty Team",
  description: "Y2K modern classic desktop with royal blue curved titlebars, emerald start accents and glossy controls",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "comfortable",
  },
  css: WHISTLER_BLISS_SKIN_CSS,
};
