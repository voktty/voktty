// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadLocale } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildUnifiedFile } from "@/modules/harness/lib/unifiedDiff";
import { UnifiedDiffView } from "@/modules/harness/surfaces/UnifiedDiffView";

vi.mock("@/modules/harness/surfaces/syntaxTokens", () => ({
  highlightDiffFile: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/modules/harness/hooks/useColorScheme", () => ({
  useColorScheme: () => "dark",
}));

let container: HTMLDivElement;
let root: Root;
const initialLanguage = usePreferencesStore.getState().language;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePreferencesStore.setState({ language: "en" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  usePreferencesStore.setState({ language: initialLanguage });
  vi.unstubAllGlobals();
});

async function render() {
  const diff = buildUnifiedFile("alpha\nbeta\ngamma\n", "alpha\nBETA\ngamma\n");
  await act(async () =>
    root.render(
      <UnifiedDiffView
        files={[
          {
            id: "a.ts",
            path: "a.ts",
            label: "a.ts",
            additions: diff.additions,
            deletions: diff.deletions,
            blocks: diff.blocks,
          },
        ]}
      />,
    ),
  );
}

function rows() {
  return [...container.querySelectorAll("span.w-7")].map((marker) => ({
    glyph: marker.querySelector('[aria-hidden="true"]')?.textContent,
    cue: marker.querySelector(".sr-only")?.textContent ?? null,
    code: marker.nextElementSibling?.textContent,
    selectable: marker.classList.contains("select-none"),
  }));
}

it("marks changed lines while keeping markers and cues outside code text", async () => {
  await render();
  expect(rows()).toEqual([
    { glyph: "", cue: null, code: "alpha", selectable: true },
    { glyph: "−", cue: "Deleted: ", code: "beta", selectable: true },
    { glyph: "+", cue: "Added: ", code: "BETA", selectable: true },
    { glyph: "", cue: null, code: "gamma", selectable: true },
  ]);
});

it("updates screen-reader cues when the interface language changes", async () => {
  await render();
  await loadLocale("es");
  await act(async () => usePreferencesStore.setState({ language: "es" }));
  expect(rows().map((row) => row.cue)).toEqual([
    null,
    "Eliminado: ",
    "Anadido: ",
    null,
  ]);
});
