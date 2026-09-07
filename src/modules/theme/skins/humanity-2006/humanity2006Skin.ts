import type { ThemeSkin } from "../../types";

/**
 * Humanity 2006 Skin
 *
 * Scoped CSS reproducing classic 2006 GNOME 2 / Dapper Drake desktop:
 * - Warm espresso brown panels and radiant African orange accents (#ea6a1a)
 * - Rounded GNOME 2 tabs with orange active bottom border
 * - High-contrast typography: crisp dark espresso on light tan cards, white on dark panels
 * - Classic Linux desktop window controls
 */
export const HUMANITY_2006_SKIN_CSS = `
/* Window Chrome & Header (Classic GNOME Panel) */
[data-theme-skin="humanity-2006"] header,
[data-theme-skin="humanity-2006"] .title-bar {
  background: linear-gradient(180deg, #3d2c25 0%, #291b17 100%) !important;
  color: #ffffff !important;
  font-family: 'Ubuntu', 'DejaVu Sans', sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #ea6a1a !important;
  padding: 3px 8px !important;
}

[data-theme-skin="humanity-2006"] .window-title {
  color: #ffffff !important;
  font-weight: bold !important;
}

/* Window Controls (Classic GNOME 2 Buttons) */
[data-theme-skin="humanity-2006"] .window-controls {
  gap: 3px !important;
}

[data-theme-skin="humanity-2006"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 3px !important;
  background: linear-gradient(180deg, #5c443b 0%, #3a2822 100%) !important;
  color: #ffffff !important;
  border: 1px solid #1c1310 !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="humanity-2006"] .window-control-button * {
  color: #ffffff !important;
}

[data-theme-skin="humanity-2006"] .window-control-button:hover {
  background: #ea6a1a !important;
}

[data-theme-skin="humanity-2006"] .window-control-button-close:hover {
  background: #c72e20 !important;
}

/* Tabs: Warm GNOME Tabs */
[data-theme-skin="humanity-2006"] .tab-item,
[data-theme-skin="humanity-2006"] [data-tab-id] {
  border-radius: 4px 4px 0 0 !important;
  background: #3a2822 !important;
  color: #d6c6be !important;
  border: 1px solid #201512 !important;
  border-bottom: none !important;
  font-family: 'Ubuntu', 'DejaVu Sans', sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="humanity-2006"] .tab-item *,
[data-theme-skin="humanity-2006"] [data-tab-id] * {
  color: #d6c6be !important;
}

[data-theme-skin="humanity-2006"] .tab-active,
[data-theme-skin="humanity-2006"] [data-tab-active="true"] {
  background: #ede6de !important;
  color: #221815 !important;
  border-color: #201512 !important;
  border-top: 2px solid #ea6a1a !important;
  font-weight: bold !important;
}

[data-theme-skin="humanity-2006"] .tab-active *,
[data-theme-skin="humanity-2006"] [data-tab-active="true"] * {
  color: #221815 !important;
  background: transparent !important;
}

/* Buttons */
[data-theme-skin="humanity-2006"] button:not(.window-control-button) {
  border-radius: 3px !important;
  background: linear-gradient(180deg, #5c433a 0%, #3e2b24 100%) !important;
  color: #ffffff !important;
  border: 1px solid #1c120f !important;
  font-family: 'Ubuntu', 'DejaVu Sans', sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 12px !important;
}

[data-theme-skin="humanity-2006"] button:not(.window-control-button) * {
  color: #ffffff !important;
}

[data-theme-skin="humanity-2006"] button:not(.window-control-button):hover {
  background: #ea6a1a !important;
  border-color: #ba4e0b !important;
}

/* Footer & Status Bar */
[data-theme-skin="humanity-2006"] footer,
[data-theme-skin="humanity-2006"] .status-bar {
  background: #241714 !important;
  color: #ede6de !important;
  border-top: 1px solid #ea6a1a !important;
}

[data-theme-skin="humanity-2006"] footer *,
[data-theme-skin="humanity-2006"] .status-bar * {
  color: #ede6de !important;
}

/* Breadcrumbs */
[data-theme-skin="humanity-2006"] [data-slot="breadcrumb"] *,
[data-theme-skin="humanity-2006"] [data-slot="breadcrumb-item"] * {
  color: #ede6de !important;
}

/* Modals & Dialogs */
[data-theme-skin="humanity-2006"] [role="dialog"] {
  background: #ede6de !important;
  border: 1px solid #ea6a1a !important;
  border-radius: 4px !important;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
}

[data-theme-skin="humanity-2006"] [role="dialog"] * {
  color: #221815 !important;
}

/* Inputs */
[data-theme-skin="humanity-2006"] input,
[data-theme-skin="humanity-2006"] textarea,
[data-theme-skin="humanity-2006"] select {
  background: #ffffff !important;
  color: #221815 !important;
  border: 1px solid #5c423a !important;
  border-radius: 3px !important;
}
`;

export const humanity2006Skin: ThemeSkin = {
  id: "humanity-2006",
  name: "Humanity 2006",
  author: "Voktty Team",
  description: "Warm Human espresso brown and radiant African orange desktop inspired by classic 2006 GNOME 2",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "3px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "comfortable",
  },
  css: HUMANITY_2006_SKIN_CSS,
};
