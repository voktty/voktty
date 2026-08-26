import type { Extension } from "@codemirror/state";

/**
 * Load the optional minimap extension only when the user enables it.
 * Keeping the import here prevents the minimap code from entering the
 * editor's eager startup path.
 */
export async function loadMinimapExtension(): Promise<Extension> {
  const { showMinimap } = await import("@replit/codemirror-minimap");

  return showMinimap.compute(["doc"], () => ({
    create: () => {
      const dom = document.createElement("div");
      dom.className = "voktty-code-minimap";
      return { dom };
    },
    displayText: "blocks",
    showOverlay: "mouse-over",
  }));
}
