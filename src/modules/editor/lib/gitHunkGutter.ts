import { getChunks } from "@codemirror/merge";
import { type Extension, RangeSet, RangeSetBuilder } from "@codemirror/state";
import { type EditorView, GutterMarker, gutter } from "@codemirror/view";

/**
 * A narrow gutter next to a read-only `unifiedMergeView` diff with one button
 * per hunk, at the line the hunk starts on. Clicking it hands the hunk's
 * `fromB` position (a `Chunk`'s own document position, from `getChunks`) to
 * `onStage` — the same position `gitChunkStaging.ts`'s `stageChunkText` takes
 * to reconstruct the file with just that hunk applied.
 */
export function gitHunkStageGutter(onStage: (pos: number) => void): Extension {
  class StageHunkMarker extends GutterMarker {
    constructor(readonly pos: number) {
      super();
    }
    eq(other: GutterMarker) {
      return other instanceof StageHunkMarker && other.pos === this.pos;
    }
    toDOM() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-stageHunkMarker";
      button.title = "Stage this change";
      button.setAttribute("aria-label", "Stage this change");
      button.textContent = "+";
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onStage(this.pos);
      });
      return button;
    }
  }

  return gutter({
    class: "cm-stageHunkGutter",
    markers(view: EditorView) {
      const info = getChunks(view.state);
      if (!info || info.chunks.length === 0) return RangeSet.empty;
      const builder = new RangeSetBuilder<GutterMarker>();
      for (const chunk of info.chunks) {
        const pos = Math.min(chunk.fromB, view.state.doc.length);
        builder.add(pos, pos, new StageHunkMarker(pos));
      }
      return builder.finish();
    },
  });
}
