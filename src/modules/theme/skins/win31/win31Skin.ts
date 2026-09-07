import type { ThemeSkin } from "../../types";

/**
 * Windows 3.1 Radical Skin
 *
 * NOTAS DE AUDITORIA DE TOKENS (Fase 4):
 * Reglas que fue necesario escribir en CSS porque ningun token de Nivel 2 llegaba:
 * 1. Biseles 3D duales (highlight #ffffff + shadow #808080 + inner #dfdfdf / #000000):
 *    Los tokens actuales solo soportan un solo color para border. Los biseles de epoca
 *    requieren 4 colores distintos por direccion (top/left claro, bottom/right oscuro)
 *    y dobles sombras de relieve con inset.
 * 2. Sustitucion de glifos en controles de ventana (.window-control-icon svg -> ::after):
 *    No existe un token para cambiar el glifo vectorial por caracteres retro (▲, ▼, ×).
 * 3. Fusion de la solapa de pestana activa con el marco de contenido (.tab-active sin borde inferior):
 *    Requiere solapar el borde inferior con el fondo del panel para dar la ilusion de carpeta fisica.
 * 4. Patrones de textura de scrollbar y tramas de semitono:
 *    La barra de desplazamiento clasica de Windows 3.1 usa una trama cuadriculada (checkerboard)
 *    de 2x2px en el track y botones con flechas en los extremos.
 * 5. Barra de titulo con color de acento solido clasico (#000080 azul marino) y texto blanco en negrita.
 */
export const WIN31_SKIN_CSS = `
/* Window Chrome & Header */
[data-theme-skin="win31"] header,
[data-theme-skin="win31"] .title-bar {
  background: #000080 !important;
  color: #ffffff !important;
  font-family: 'MS Sans Serif', 'Microsoft Sans Serif', 'Segoe UI', Tahoma, sans-serif !important;
  font-weight: bold !important;
  border-bottom: 2px solid #000000 !important;
  padding: 2px 4px !important;
}

[data-theme-skin="win31"] header span,
[data-theme-skin="win31"] .title-bar span {
  color: #ffffff !important;
}

/* Window Controls (Classic Windows 3.1 Beveled Buttons) */
[data-theme-skin="win31"] .window-controls {
  gap: 2px !important;
  padding-right: 2px !important;
}

[data-theme-skin="win31"] .window-control-button {
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
  border-radius: 0 !important;
  background: #c0c0c0 !important;
  color: #000000 !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #808080 !important;
  border-bottom: 2px solid #808080 !important;
  box-shadow: inset 1px 1px 0px #dfdfdf, inset -1px -1px 0px #000000 !important;
  position: relative !important;
  cursor: pointer !important;
}

[data-theme-skin="win31"] .window-control-button:active {
  border-top: 2px solid #000000 !important;
  border-left: 2px solid #000000 !important;
  border-right: 2px solid #ffffff !important;
  border-bottom: 2px solid #ffffff !important;
  box-shadow: inset 1px 1px 0px #808080 !important;
}

/* Hide modern SVG icons and render classic 3.1 glyphs */
[data-theme-skin="win31"] .window-control-icon svg {
  display: none !important;
}

[data-theme-skin="win31"] .window-control-button-minimize::after {
  content: "▼";
  font-size: 8px;
  font-family: sans-serif;
  color: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

[data-theme-skin="win31"] .window-control-button-maximize::after {
  content: "▲";
  font-size: 8px;
  font-family: sans-serif;
  color: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

[data-theme-skin="win31"] .window-control-button-close::after {
  content: "×";
  font-size: 14px;
  font-weight: 900;
  font-family: monospace;
  color: #000000;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* Notebook Tabs */
[data-theme-skin="win31"] .tab-item,
[data-theme-skin="win31"] [data-tab-id] {
  border-radius: 0 !important;
  background: #c0c0c0 !important;
  color: #000000 !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #808080 !important;
  border-bottom: 2px solid #808080 !important;
  margin-right: 2px !important;
}

[data-theme-skin="win31"] .tab-active,
[data-theme-skin="win31"] [data-tab-active="true"] {
  background: #ffffff !important;
  color: #000000 !important;
  font-weight: bold !important;
  border-bottom: 2px solid #ffffff !important;
}

/* Buttons */
[data-theme-skin="win31"] button:not(.window-control-button) {
  border-radius: 0 !important;
  background: #c0c0c0 !important;
  color: #000000 !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #808080 !important;
  border-bottom: 2px solid #808080 !important;
  box-shadow: inset 1px 1px 0px #dfdfdf, inset -1px -1px 0px #000000 !important;
}

[data-theme-skin="win31"] button:not(.window-control-button):active {
  border-top: 2px solid #000000 !important;
  border-left: 2px solid #000000 !important;
  border-right: 2px solid #ffffff !important;
  border-bottom: 2px solid #ffffff !important;
  box-shadow: inset 1px 1px 0px #808080 !important;
}

/* Client Panels & Surfaces: Inset 3D border */
[data-theme-skin="win31"] .surface-pane,
[data-theme-skin="win31"] [data-slot-kind="terminal"] {
  border-top: 2px solid #808080 !important;
  border-left: 2px solid #808080 !important;
  border-right: 2px solid #ffffff !important;
  border-bottom: 2px solid #ffffff !important;
  box-shadow: inset 1px 1px 0px #000000 !important;
}

/* Input Fields */
[data-theme-skin="win31"] input,
[data-theme-skin="win31"] textarea,
[data-theme-skin="win31"] select {
  border-radius: 0 !important;
  background: #ffffff !important;
  color: #000000 !important;
  border-top: 2px solid #808080 !important;
  border-left: 2px solid #808080 !important;
  border-right: 2px solid #ffffff !important;
  border-bottom: 2px solid #ffffff !important;
  box-shadow: inset 1px 1px 0px #000000 !important;
}

/* Dotted focus rectangle */
[data-theme-skin="win31"] *:focus-visible {
  outline: 1px dotted #000000 !important;
  outline-offset: -2px !important;
}

/* Classic Windows 3.1 Scrollbars */
[data-theme-skin="win31"] ::-webkit-scrollbar {
  width: 16px !important;
  height: 16px !important;
}

[data-theme-skin="win31"] ::-webkit-scrollbar-track {
  background-color: #c0c0c0 !important;
  background-image: linear-gradient(45deg, #808080 25%, transparent 25%),
                    linear-gradient(-45deg, #808080 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #808080 75%),
                    linear-gradient(-45deg, transparent 75%, #808080 75%) !important;
  background-size: 2px 2px !important;
}

[data-theme-skin="win31"] ::-webkit-scrollbar-thumb {
  background: #c0c0c0 !important;
  border-top: 2px solid #ffffff !important;
  border-left: 2px solid #ffffff !important;
  border-right: 2px solid #808080 !important;
  border-bottom: 2px solid #808080 !important;
  box-shadow: inset 1px 1px 0px #dfdfdf, inset -1px -1px 0px #000000 !important;
}
`;

export const win31Skin: ThemeSkin = {
  id: "win31",
  name: "Windows 3.1",
  description: "Authentic 16-bit graphical user interface skin with 3D beveled chrome and classic typography",
  author: "Voktty Team",
  css: WIN31_SKIN_CSS,
  windowCorners: "square",
  structuralTraits: {
    elevationStyle: "bevel",
    pillRadius: "0px",
    borderWidth: "2px",
    borderStyle: "solid",
    focusStyle: "dotted",
    uiFontFamily: "'MS Sans Serif', 'Microsoft Sans Serif', 'Segoe UI', Tahoma, sans-serif",
    uiFontSmoothing: "none",
    density: "compact",
    windowCorners: "square",
  },
};
