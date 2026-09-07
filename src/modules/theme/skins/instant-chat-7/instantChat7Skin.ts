import type { ThemeSkin } from "../../types";

/**
 * Instant Chat 7 Skin
 *
 * Scoped CSS reproducing the mid-2000s instant messaging aesthetic:
 * - Friendly sky-blue chrome header with subtle gloss (#d6e8fb / #4a8cd4)
 * - Soft rounded card bevels and status presence dot accents (#28a745)
 * - Speech-bubble styled tab framing and comfortable tactile buttons
 * - High contrast dark navy / clean white typography
 */
export const INSTANT_CHAT_7_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="instant-chat-7"] header,
[data-theme-skin="instant-chat-7"] .title-bar {
  background: linear-gradient(180deg, #e4f0fc 0%, #b8d7f7 100%) !important;
  color: #0d2847 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, sans-serif !important;
  font-weight: 600 !important;
  border-bottom: 1px solid #7ea8d6 !important;
  box-shadow: 0 1px 3px rgba(30, 80, 140, 0.15) !important;
  padding: 3px 8px !important;
}

[data-theme-skin="instant-chat-7"] .window-title {
  color: #0d2847 !important;
  font-weight: 600 !important;
  letter-spacing: 0.2px !important;
  display: flex !important;
  align-items: center !important;
}

/* Window Controls (Soft Rounded XP/MSN Style Buttons) */
[data-theme-skin="instant-chat-7"] .window-controls {
  gap: 3px !important;
}

[data-theme-skin="instant-chat-7"] .window-control-button {
  width: 19px !important;
  height: 19px !important;
  min-width: 19px !important;
  border-radius: 4px !important;
  background: linear-gradient(180deg, #ffffff 0%, #d5e6f8 100%) !important;
  color: #1a446c !important;
  border: 1px solid #8cb1db !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
  cursor: pointer !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

[data-theme-skin="instant-chat-7"] .window-control-button * {
  color: #1a446c !important;
}

[data-theme-skin="instant-chat-7"] .window-control-button:hover {
  background: linear-gradient(180deg, #eaf3fe 0%, #b9daf9 100%) !important;
  border-color: #558ac7 !important;
  color: #0d2847 !important;
}

[data-theme-skin="instant-chat-7"] .window-control-button:hover * {
  color: #0d2847 !important;
}

[data-theme-skin="instant-chat-7"] .window-control-button-close:hover {
  background: linear-gradient(180deg, #ff9999 0%, #e64040 100%) !important;
  border-color: #c02020 !important;
  color: #ffffff !important;
}

[data-theme-skin="instant-chat-7"] .window-control-button-close:hover * {
  color: #ffffff !important;
}

/* Tabs: Friendly Pill / Speech Bubble Tabs */
[data-theme-skin="instant-chat-7"] .tab-item,
[data-theme-skin="instant-chat-7"] [data-tab-id] {
  border-radius: 6px 6px 0 0 !important;
  background: #cbe0f5 !important;
  color: #1c4570 !important;
  border: 1px solid #90b3db !important;
  border-bottom: none !important;
  font-family: -apple-system, BlinkMacSystemFont, Tahoma, sans-serif !important;
  font-weight: 500 !important;
  margin-right: 2px !important;
  padding: 3px 10px !important;
}

[data-theme-skin="instant-chat-7"] .tab-item *,
[data-theme-skin="instant-chat-7"] [data-tab-id] * {
  color: #1c4570 !important;
}

[data-theme-skin="instant-chat-7"] .tab-active,
[data-theme-skin="instant-chat-7"] [data-tab-active="true"] {
  background: #ffffff !important;
  color: #005a9e !important;
  border-color: #7ea8d6 !important;
  border-bottom: 2px solid #ffffff !important;
  font-weight: 600 !important;
}

[data-theme-skin="instant-chat-7"] .tab-active *,
[data-theme-skin="instant-chat-7"] [data-tab-active="true"] * {
  color: #005a9e !important;
  background: transparent !important;
}

/* Buttons (Tactile Sky Gradient Buttons) */
[data-theme-skin="instant-chat-7"] button:not(.window-control-button) {
  border-radius: 5px !important;
  background: linear-gradient(180deg, #ffffff 0%, #d4e6f9 100%) !important;
  color: #0d2847 !important;
  border: 1px solid #7ea8d6 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06) !important;
  font-family: -apple-system, BlinkMacSystemFont, Tahoma, sans-serif !important;
  font-weight: 500 !important;
  padding: 4px 12px !important;
}

[data-theme-skin="instant-chat-7"] button:not(.window-control-button) * {
  color: #0d2847 !important;
}

[data-theme-skin="instant-chat-7"] button:not(.window-control-button):hover {
  background: linear-gradient(180deg, #f5f9ff 0%, #b8d8fa 100%) !important;
  border-color: #4a8cd4 !important;
}

/* Footer & Status Bar */
[data-theme-skin="instant-chat-7"] footer,
[data-theme-skin="instant-chat-7"] .status-bar {
  background: #d6e8fb !important;
  color: #1c4570 !important;
  border-top: 1px solid #96bae2 !important;
}

[data-theme-skin="instant-chat-7"] footer *,
[data-theme-skin="instant-chat-7"] .status-bar * {
  color: #1c4570 !important;
}

/* Breadcrumbs */
[data-theme-skin="instant-chat-7"] [data-slot="breadcrumb"] *,
[data-theme-skin="instant-chat-7"] [data-slot="breadcrumb-item"] * {
  color: #005a9e !important;
}

/* Modals & Dialogs */
[data-theme-skin="instant-chat-7"] [role="dialog"] {
  background: #f4f8fd !important;
  border: 1px solid #7ea8d6 !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(13, 40, 71, 0.2) !important;
}

[data-theme-skin="instant-chat-7"] [role="dialog"] * {
  color: #0d2847 !important;
}

/* Inputs */
[data-theme-skin="instant-chat-7"] input,
[data-theme-skin="instant-chat-7"] textarea,
[data-theme-skin="instant-chat-7"] select {
  background: #ffffff !important;
  color: #0d2847 !important;
  border: 1px solid #7ea8d6 !important;
  border-radius: 4px !important;
}
`;

export const instantChat7Skin: ThemeSkin = {
  id: "instant-chat-7",
  name: "Instant Chat 7",
  author: "Voktty Team",
  description: "Mid-2000s instant messenger aesthetic with sky blue headers, tactile bubble cards and online presence accents",
  windowCorners: "round",
  structuralTraits: {
    elevationStyle: "soft",
    pillRadius: "8px",
    borderWidth: "1px",
    borderStyle: "solid",
    focusStyle: "ring",
    uiFontSmoothing: "antialiased",
    density: "comfortable",
  },
  css: INSTANT_CHAT_7_SKIN_CSS,
};
