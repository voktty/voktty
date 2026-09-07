import type { ThemeSkin } from "../../types";

/**
 * ClickWheel Pod Skin
 *
 * Scoped CSS reproducing the iconic white ceramic and stainless steel MP3 player:
 * - Pure ceramic white and glossy brushed stainless steel borders
 * - Signature cyan selection bar banner (#007aff / #0275d8) with white bold text
 * - Clean compact sans-serif typography
 * - Smooth minimalist pill buttons
 */
export const CLICK_WHEEL_POD_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="clickwheel-pod"] header,
[data-theme-skin="clickwheel-pod"] .title-bar {
  background: linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%) !important;
  color: #111827 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif !important;
  font-weight: 600 !important;
  border-bottom: 1px solid #d1d5db !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
  padding: 3px 8px !important;
}

[data-theme-skin="clickwheel-pod"] .window-title {
  color: #111827 !important;
  font-weight: 600 !important;
}

/* Window Controls (Minimalist Dots) */
[data-theme-skin="clickwheel-pod"] .window-controls {
  gap: 4px !important;
}

[data-theme-skin="clickwheel-pod"] .window-control-button {
  width: 16px !important;
  height: 16px !important;
  min-width: 16px !important;
  border-radius: 50% !important;
  background: #e5e7eb !important;
  color: #4b5563 !important;
  border: 1px solid #d1d5db !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="clickwheel-pod"] .window-control-button * {
  color: #4b5563 !important;
}

[data-theme-skin="clickwheel-pod"] .window-control-button:hover {
  background: #007aff !important;
  color: #ffffff !important;
}

[data-theme-skin="clickwheel-pod"] .window-control-button:hover * {
  color: #ffffff !important;
}

[data-theme-skin="clickwheel-pod"] .window-control-button-close:hover {
  background: #ef4444 !important;
  color: #ffffff !important;
}

[data-theme-skin="clickwheel-pod"] .window-control-button-close:hover * {
  color: #ffffff !important;
}

/* Tabs: Signature iPod List Selection Tabs */
[data-theme-skin="clickwheel-pod"] .tab-item,
[data-theme-skin="clickwheel-pod"] [data-tab-id] {
  border-radius: 4px 4px 0 0 !important;
  background: #f3f4f6 !important;
  color: #374151 !important;
  border: 1px solid #e5e7eb !important;
  border-bottom: none !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  margin-right: 2px !important;
  padding: 3px 12px !important;
}

[data-theme-skin="clickwheel-pod"] .tab-item *,
[data-theme-skin="clickwheel-pod"] [data-tab-id] * {
  color: #374151 !important;
}

[data-theme-skin="clickwheel-pod"] .tab-active,
[data-theme-skin="clickwheel-pod"] [data-tab-active="true"] {
  background: linear-gradient(180deg, #3897ff 0%, #007aff 100%) !important;
  color: #ffffff !important;
  border-color: #0062cc !important;
  font-weight: 600 !important;
}

[data-theme-skin="clickwheel-pod"] .tab-active *,
[data-theme-skin="clickwheel-pod"] [data-tab-active="true"] * {
  color: #ffffff !important;
  background: transparent !important;
}

/* Buttons */
[data-theme-skin="clickwheel-pod"] button:not(.window-control-button) {
  border-radius: 9999px !important;
  background: linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%) !important;
  color: #111827 !important;
  border: 1px solid #d1d5db !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 14px !important;
}

[data-theme-skin="clickwheel-pod"] button:not(.window-control-button) * {
  color: #111827 !important;
}

[data-theme-skin="clickwheel-pod"] button:not(.window-control-button):hover {
  background: #007aff !important;
  color: #ffffff !important;
  border-color: #0062cc !important;
}

[data-theme-skin="clickwheel-pod"] button:not(.window-control-button):hover * {
  color: #ffffff !important;
}

/* Footer & Status Bar */
[data-theme-skin="clickwheel-pod"] footer,
[data-theme-skin="clickwheel-pod"] .status-bar {
  background: #f9fafb !important;
  color: #4b5563 !important;
  border-top: 1px solid #e5e7eb !important;
}

[data-theme-skin="clickwheel-pod"] footer *,
[data-theme-skin="clickwheel-pod"] .status-bar * {
  color: #4b5563 !important;
}

/* Breadcrumbs */
[data-theme-skin="clickwheel-pod"] [data-slot="breadcrumb"] *,
[data-theme-skin="clickwheel-pod"] [data-slot="breadcrumb-item"] * {
  color: #4b5563 !important;
}

/* Modals & Dialogs */
[data-theme-skin="clickwheel-pod"] [role="dialog"] {
  background: #ffffff !important;
  border: 1px solid #d1d5db !important;
  border-radius: 8px !important;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1) !important;
}

[data-theme-skin="clickwheel-pod"] [role="dialog"] * {
  color: #111827 !important;
}

/* Inputs */
[data-theme-skin="clickwheel-pod"] input,
[data-theme-skin="clickwheel-pod"] textarea,
[data-theme-skin="clickwheel-pod"] select {
  background: #ffffff !important;
  color: #111827 !important;
  border: 1px solid #d1d5db !important;
  border-radius: 6px !important;
}
`;

export const clickWheelPodSkin: ThemeSkin = {
  id: "clickwheel-pod",
  name: "ClickWheel Pod",
  author: "Voktty Team",
  description: "Polished stainless steel and pure white porcelain player with cyan selection highlights and compact sans typography",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "soft",
    pillRadius: "9999px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "comfortable",
  },
  css: CLICK_WHEEL_POD_SKIN_CSS,
};
