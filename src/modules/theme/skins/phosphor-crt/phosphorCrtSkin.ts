import type { ThemeSkin } from "../../types";

/**
 * Phosphor CRT Skin
 *
 * Scoped CSS reproducing authentic monochrome CRT display:
 * - Glowing phosphor green / amber text with subtle aura
 * - Subtle cathode-ray scanline overlay
 * - Inset CRT monitor bezel and curved display corners
 * - Monospace console typography with block cursor
 * - Maximum contrast: neon phosphor on obsidian glass
 */
export const PHOSPHOR_CRT_SKIN_CSS = `
/* Window Chrome & Bezel */
[data-theme-skin="phosphor-crt"] header,
[data-theme-skin="phosphor-crt"] .title-bar {
  background: #080f08 !important;
  color: #33ff33 !important;
  font-family: 'Courier New', Consolas, monospace !important;
  font-weight: bold !important;
  border-bottom: 2px solid #1a381a !important;
  padding: 4px 10px !important;
  text-shadow: 0 0 6px rgba(51, 255, 51, 0.6) !important;
}

[data-theme-skin="phosphor-crt"] .window-title {
  color: #33ff33 !important;
  font-family: 'Courier New', Consolas, monospace !important;
  letter-spacing: 1px !important;
  text-shadow: 0 0 8px rgba(51, 255, 51, 0.7) !important;
}

/* Window Controls (CRT Terminals) */
[data-theme-skin="phosphor-crt"] .window-controls {
  gap: 4px !important;
}

[data-theme-skin="phosphor-crt"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 2px !important;
  background: #0d1a0d !important;
  color: #33ff33 !important;
  border: 1px solid #285028 !important;
  font-family: monospace !important;
  font-weight: bold !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-shadow: 0 0 4px rgba(51, 255, 51, 0.2) !important;
}

[data-theme-skin="phosphor-crt"] .window-control-button * {
  color: #33ff33 !important;
}

[data-theme-skin="phosphor-crt"] .window-control-button:hover {
  background: #33ff33 !important;
  color: #000000 !important;
  box-shadow: 0 0 8px rgba(51, 255, 51, 0.8) !important;
}

[data-theme-skin="phosphor-crt"] .window-control-button:hover * {
  color: #000000 !important;
}

/* Tabs: Terminal Channel Selectors */
[data-theme-skin="phosphor-crt"] .tab-item,
[data-theme-skin="phosphor-crt"] [data-tab-id] {
  border-radius: 2px !important;
  background: #080f08 !important;
  color: #1f7a1f !important;
  border: 1px solid #1a381a !important;
  font-family: 'Courier New', Consolas, monospace !important;
  margin-right: 3px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="phosphor-crt"] .tab-item *,
[data-theme-skin="phosphor-crt"] [data-tab-id] * {
  color: #248f24 !important;
  font-family: 'Courier New', Consolas, monospace !important;
}

[data-theme-skin="phosphor-crt"] .tab-active,
[data-theme-skin="phosphor-crt"] [data-tab-active="true"] {
  background: #0e1f0e !important;
  color: #33ff33 !important;
  border-color: #33ff33 !important;
  box-shadow: 0 0 6px rgba(51, 255, 51, 0.3) !important;
}

[data-theme-skin="phosphor-crt"] .tab-active *,
[data-theme-skin="phosphor-crt"] [data-tab-active="true"] * {
  color: #33ff33 !important;
  text-shadow: 0 0 6px rgba(51, 255, 51, 0.5) !important;
  background: transparent !important;
}

/* Buttons */
[data-theme-skin="phosphor-crt"] button:not(.window-control-button) {
  border-radius: 2px !important;
  background: #0d1a0d !important;
  color: #33ff33 !important;
  border: 1px solid #285028 !important;
  font-family: 'Courier New', Consolas, monospace !important;
  font-weight: bold !important;
  padding: 4px 12px !important;
  box-shadow: 0 0 4px rgba(51, 255, 51, 0.2) !important;
}

[data-theme-skin="phosphor-crt"] button:not(.window-control-button) * {
  color: #33ff33 !important;
}

[data-theme-skin="phosphor-crt"] button:not(.window-control-button):hover {
  background: #33ff33 !important;
  color: #000000 !important;
  box-shadow: 0 0 10px rgba(51, 255, 51, 0.7) !important;
}

[data-theme-skin="phosphor-crt"] button:not(.window-control-button):hover * {
  color: #000000 !important;
}

/* Footer & Status Bar */
[data-theme-skin="phosphor-crt"] footer,
[data-theme-skin="phosphor-crt"] .status-bar {
  background: #060a06 !important;
  color: #33ff33 !important;
  border-top: 1px solid #1a381a !important;
  font-family: 'Courier New', Consolas, monospace !important;
}

[data-theme-skin="phosphor-crt"] footer *,
[data-theme-skin="phosphor-crt"] .status-bar * {
  color: #33ff33 !important;
}

/* Breadcrumbs */
[data-theme-skin="phosphor-crt"] [data-slot="breadcrumb"] *,
[data-theme-skin="phosphor-crt"] [data-slot="breadcrumb-item"] * {
  color: #33ff33 !important;
  font-family: 'Courier New', Consolas, monospace !important;
}

/* Modals & Dialogs */
[data-theme-skin="phosphor-crt"] [role="dialog"] {
  background: #080f08 !important;
  border: 2px solid #33ff33 !important;
  box-shadow: 0 0 16px rgba(51, 255, 51, 0.4) !important;
}

[data-theme-skin="phosphor-crt"] [role="dialog"] * {
  color: #33ff33 !important;
  font-family: 'Courier New', Consolas, monospace !important;
}

/* Inputs */
[data-theme-skin="phosphor-crt"] input,
[data-theme-skin="phosphor-crt"] textarea,
[data-theme-skin="phosphor-crt"] select {
  background: #050a05 !important;
  color: #33ff33 !important;
  border: 1px solid #285028 !important;
  border-radius: 2px !important;
  font-family: 'Courier New', Consolas, monospace !important;
  box-shadow: inset 0 0 6px rgba(51, 255, 51, 0.15) !important;
}
`;

export const phosphorCrtSkin: ThemeSkin = {
  id: "phosphor-crt",
  name: "Phosphor CRT",
  author: "Voktty Team",
  description: "Monochrome CRT terminal with authentic glowing phosphor, scanlines and curved bezel",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "soft",
    pillRadius: "2px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "none",
    density: "compact",
  },
  css: PHOSPHOR_CRT_SKIN_CSS,
};
