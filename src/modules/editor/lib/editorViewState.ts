export type PersistedEditorViewState = {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeEditorViewState(
  state: PersistedEditorViewState,
  documentLength: number,
): PersistedEditorViewState {
  const limit = Math.max(0, Math.trunc(finite(documentLength)));
  const position = (value: number) =>
    Math.max(0, Math.min(limit, Math.trunc(finite(value))));
  return {
    anchor: position(state.anchor),
    head: position(state.head),
    scrollTop: Math.max(0, finite(state.scrollTop)),
    scrollLeft: Math.max(0, finite(state.scrollLeft)),
  };
}
