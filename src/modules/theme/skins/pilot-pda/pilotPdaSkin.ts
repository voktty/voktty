import type { ThemeSkin } from "../../types";

/**
 * Pilot PDA Skin
 *
 * Scoped CSS reproducing the classic 160x160 monochrome stylus organizer:
 * - Olive-gray transflective LCD background (#a2b096)
 * - Deep black ink typography and thin 1px borders
 * - Compact stylus-friendly pill buttons and list rows
 * - High contrast: dark ink on paper LCD
 */
export const PILOT_PDA_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="pilot-pda"] header,
[data-theme-skin="pilot-pda"] .title-bar {
  background: #141a10 !important;
  color: #b0be9f !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #141a10 !important;
  padding: 3px 8px !important;
}

[data-theme-skin="pilot-pda"] .window-title {
  color: #b0be9f !important;
  font-weight: bold !important;
}

/* Window Controls (Minimalist Square Toggles) */
[data-theme-skin="pilot-pda"] .window-controls {
  gap: 3px !important;
}

[data-theme-skin="pilot-pda"] .window-control-button {
  width: 17px !important;
  height: 17px !important;
  min-width: 17px !important;
  border-radius: 2px !important;
  background: #b0be9f !important;
  color: #141a10 !important;
  border: 1px solid #141a10 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="pilot-pda"] .window-control-button * {
  color: #141a10 !important;
}

[data-theme-skin="pilot-pda"] .window-control-button:hover {
  background: #141a10 !important;
  color: #b0be9f !important;
}

[data-theme-skin="pilot-pda"] .window-control-button:hover * {
  color: #b0be9f !important;
}

/* Tabs: Minimalist PDA Record Tabs */
[data-theme-skin="pilot-pda"] .tab-item,
[data-theme-skin="pilot-pda"] [data-tab-id] {
  border-radius: 3px 3px 0 0 !important;
  background: #8d9a82 !important;
  color: #141a10 !important;
  border: 1px solid #141a10 !important;
  border-bottom: none !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="pilot-pda"] .tab-item *,
[data-theme-skin="pilot-pda"] [data-tab-id] * {
  color: #141a10 !important;
}

[data-theme-skin="pilot-pda"] .tab-active,
[data-theme-skin="pilot-pda"] [data-tab-active="true"] {
  background: #b0be9f !important;
  color: #141a10 !important;
  border-color: #141a10 !important;
  font-weight: bold !important;
}

[data-theme-skin="pilot-pda"] .tab-active *,
[data-theme-skin="pilot-pda"] [data-tab-active="true"] * {
  color: #141a10 !important;
  background: transparent !important;
}

/* Buttons (Compact PDA Pill Buttons) */
[data-theme-skin="pilot-pda"] button:not(.window-control-button) {
  border-radius: 3px !important;
  background: #b0be9f !important;
  color: #141a10 !important;
  border: 1px solid #141a10 !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  font-weight: 600 !important;
  padding: 3px 10px !important;
}

[data-theme-skin="pilot-pda"] button:not(.window-control-button) * {
  color: #141a10 !important;
}

[data-theme-skin="pilot-pda"] button:not(.window-control-button):hover {
  background: #141a10 !important;
  color: #b0be9f !important;
}

[data-theme-skin="pilot-pda"] button:not(.window-control-button):hover * {
  color: #b0be9f !important;
}

/* Footer & Status Bar */
[data-theme-skin="pilot-pda"] footer,
[data-theme-skin="pilot-pda"] .status-bar {
  background: #8d9a82 !important;
  color: #141a10 !important;
  border-top: 1px solid #141a10 !important;
}

[data-theme-skin="pilot-pda"] footer *,
[data-theme-skin="pilot-pda"] .status-bar * {
  color: #141a10 !important;
}

/* Breadcrumbs */
[data-theme-skin="pilot-pda"] [data-slot="breadcrumb"] *,
[data-theme-skin="pilot-pda"] [data-slot="breadcrumb-item"] * {
  color: #141a10 !important;
}

/* Modals & Dialogs */
[data-theme-skin="pilot-pda"] [role="dialog"] {
  background: #b0be9f !important;
  border: 2px solid #141a10 !important;
  box-shadow: 4px 4px 0px rgba(20, 26, 16, 0.4) !important;
}

[data-theme-skin="pilot-pda"] [role="dialog"] * {
  color: #141a10 !important;
}

/* Inputs */
[data-theme-skin="pilot-pda"] input,
[data-theme-skin="pilot-pda"] textarea,
[data-theme-skin="pilot-pda"] select {
  background: #b0be9f !important;
  color: #141a10 !important;
  border: 1px solid #141a10 !important;
  border-radius: 2px !important;
}
`;

export const pilotPdaSkin: ThemeSkin = {
  id: "pilot-pda",
  name: "Pilot PDA",
  author: "Voktty Team",
  description: "Classic 160x160 monochrome stylus organizer with olive-gray LCD, compact border buttons and list rows",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "flat",
    pillRadius: "3px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "dotted",
    uiFontSmoothing: "antialiased",
    density: "compact",
  },
  css: PILOT_PDA_SKIN_CSS,
};
