import type { ThemeSkin } from "../../types";

/**
 * AudioAMP Classic Skin
 *
 * Scoped CSS reproducing the legendary 90s MP3 player:
 * - Dark brushed metallic titanium chassis (#202225)
 * - Electric lime green LED text and indicators (#00ff41)
 * - Spectrum visualizer peak orange/red accents
 * - Beveled hardware playback buttons and digital display framing
 */
export const AUDIO_AMP_CLASSIC_SKIN_CSS = `
/* Window Chrome & Header (Player Top Bar) */
[data-theme-skin="audioamp-classic"] header,
[data-theme-skin="audioamp-classic"] .title-bar {
  background: linear-gradient(180deg, #2e3036 0%, #1a1b1e 100%) !important;
  color: #00ff41 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  font-weight: bold !important;
  border-bottom: 2px solid #101114 !important;
  box-shadow: inset 0 1px 0 #454850 !important;
  padding: 3px 8px !important;
}

[data-theme-skin="audioamp-classic"] .window-title {
  color: #00ff41 !important;
  font-family: 'Consolas', 'Courier New', monospace !important;
  letter-spacing: 1px !important;
  text-shadow: 0 0 6px rgba(0, 255, 65, 0.5) !important;
}

/* Window Controls (Brushed Beveled Buttons) */
[data-theme-skin="audioamp-classic"] .window-controls {
  gap: 3px !important;
}

[data-theme-skin="audioamp-classic"] .window-control-button {
  width: 17px !important;
  height: 17px !important;
  min-width: 17px !important;
  border-radius: 2px !important;
  background: linear-gradient(180deg, #3d4048 0%, #24262b 100%) !important;
  color: #00ff41 !important;
  border: 1px solid #121316 !important;
  box-shadow: inset 0 1px 0 #585c66, inset 0 -1px 0 #18191c !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="audioamp-classic"] .window-control-button * {
  color: #00ff41 !important;
}

[data-theme-skin="audioamp-classic"] .window-control-button:hover {
  background: #00ff41 !important;
  color: #000000 !important;
}

[data-theme-skin="audioamp-classic"] .window-control-button:hover * {
  color: #000000 !important;
}

[data-theme-skin="audioamp-classic"] .window-control-button-close:hover {
  background: #ff3300 !important;
  color: #ffffff !important;
}

[data-theme-skin="audioamp-classic"] .window-control-button-close:hover * {
  color: #ffffff !important;
}

/* Tabs: Equalizer Band Tabs */
[data-theme-skin="audioamp-classic"] .tab-item,
[data-theme-skin="audioamp-classic"] [data-tab-id] {
  border-radius: 2px 2px 0 0 !important;
  background: #18191d !important;
  color: #7a8290 !important;
  border: 1px solid #101114 !important;
  border-bottom: none !important;
  font-family: 'Consolas', monospace !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="audioamp-classic"] .tab-item *,
[data-theme-skin="audioamp-classic"] [data-tab-id] * {
  color: #7a8290 !important;
}

[data-theme-skin="audioamp-classic"] .tab-active,
[data-theme-skin="audioamp-classic"] [data-tab-active="true"] {
  background: #2a2c32 !important;
  color: #00ff41 !important;
  border-color: #383c44 !important;
  border-top: 2px solid #00ff41 !important;
  font-weight: bold !important;
}

[data-theme-skin="audioamp-classic"] .tab-active *,
[data-theme-skin="audioamp-classic"] [data-tab-active="true"] * {
  color: #00ff41 !important;
  text-shadow: 0 0 5px rgba(0, 255, 65, 0.4) !important;
  background: transparent !important;
}

/* Buttons (Playback Hardware Buttons) */
[data-theme-skin="audioamp-classic"] button:not(.window-control-button) {
  border-radius: 2px !important;
  background: linear-gradient(180deg, #3d4048 0%, #24262b 100%) !important;
  color: #f0f4f8 !important;
  border: 1px solid #121316 !important;
  box-shadow: inset 0 1px 0 #5a606c, inset 0 -1px 0 #181a1d, 0 1px 2px rgba(0, 0, 0, 0.4) !important;
  font-family: 'Consolas', monospace !important;
  font-weight: bold !important;
  padding: 4px 12px !important;
}

[data-theme-skin="audioamp-classic"] button:not(.window-control-button) * {
  color: #f0f4f8 !important;
}

[data-theme-skin="audioamp-classic"] button:not(.window-control-button):hover {
  border-color: #00ff41 !important;
  color: #00ff41 !important;
}

[data-theme-skin="audioamp-classic"] button:not(.window-control-button):hover * {
  color: #00ff41 !important;
}

/* Footer & Status Bar */
[data-theme-skin="audioamp-classic"] footer,
[data-theme-skin="audioamp-classic"] .status-bar {
  background: #141518 !important;
  color: #00ff41 !important;
  border-top: 1px solid #282a30 !important;
  font-family: 'Consolas', monospace !important;
}

[data-theme-skin="audioamp-classic"] footer *,
[data-theme-skin="audioamp-classic"] .status-bar * {
  color: #00ff41 !important;
}

/* Breadcrumbs */
[data-theme-skin="audioamp-classic"] [data-slot="breadcrumb"] *,
[data-theme-skin="audioamp-classic"] [data-slot="breadcrumb-item"] * {
  color: #00ff41 !important;
}

/* Modals & Dialogs */
[data-theme-skin="audioamp-classic"] [role="dialog"] {
  background: #202225 !important;
  border: 2px solid #3a3d46 !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7) !important;
}

[data-theme-skin="audioamp-classic"] [role="dialog"] * {
  color: #f0f4f8 !important;
}

/* Inputs */
[data-theme-skin="audioamp-classic"] input,
[data-theme-skin="audioamp-classic"] textarea,
[data-theme-skin="audioamp-classic"] select {
  background: #121316 !important;
  color: #00ff41 !important;
  border: 1px solid #2e3138 !important;
  border-radius: 2px !important;
  font-family: 'Consolas', monospace !important;
}
`;

export const audioAmpClassicSkin: ThemeSkin = {
  id: "audioamp-classic",
  name: "AudioAMP Classic",
  author: "Voktty Team",
  description: "Legendary 90s MP3 player with dark brushed titanium alloy, electric green LED digits and spectrum visualizer",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "2px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "compact",
  },
  css: AUDIO_AMP_CLASSIC_SKIN_CSS,
};
