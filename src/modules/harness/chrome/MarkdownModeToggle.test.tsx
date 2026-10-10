// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  markdownModeKey,
  useMarkdownMode,
  type MarkdownViewMode,
} from "./MarkdownModeToggle";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function ModeProbe({
  modeKey,
  fallback,
}: {
  modeKey: string;
  fallback: MarkdownViewMode;
}) {
  const [mode, setMode] = useMarkdownMode(modeKey, fallback);
  return createElement(
    "button",
    {
      type: "button",
      "data-mode": mode,
      onClick: () => setMode(mode === "source" ? "preview" : "source"),
    },
    mode,
  );
}

async function renderMode(modeKey: string, fallback: MarkdownViewMode) {
  await act(async () => {
    root.render(createElement(ModeProbe, { modeKey, fallback }));
  });
}

async function toggleMode() {
  await act(async () => {
    container.querySelector("button")?.click();
  });
}

it("opens review Markdown in source mode with a preference separate from the file", async () => {
  const path = "/project/README.md";
  const fileKey = markdownModeKey(path, false);
  const reviewKey = markdownModeKey(path, true);
  expect(fileKey).toBe(path);
  expect(reviewKey).toBe(`review:${path}`);

  await renderMode(fileKey, "preview");
  expect(container.querySelector("button")?.dataset.mode).toBe("preview");
  await toggleMode();
  expect(container.querySelector("button")?.dataset.mode).toBe("source");

  await renderMode(reviewKey, "source");
  expect(container.querySelector("button")?.dataset.mode).toBe("source");
  await toggleMode();
  expect(container.querySelector("button")?.dataset.mode).toBe("preview");

  await renderMode(fileKey, "preview");
  expect(container.querySelector("button")?.dataset.mode).toBe("source");
  await renderMode(reviewKey, "source");
  expect(container.querySelector("button")?.dataset.mode).toBe("preview");
});
