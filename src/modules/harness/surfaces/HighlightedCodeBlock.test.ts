// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { HighlightResult } from "@streamdown/code";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { boundedCode } from "@/modules/harness/surfaces/codeHighlightPlugin";
import { HighlightedCodeBlock } from "@/modules/harness/surfaces/HighlightedCodeBlock";

let cleanup: (() => void) | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const result = (text: string): HighlightResult => ({
  tokens: text.split("\n").map((content, offset) => [{ content, offset }]),
});

function setup() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const render = (code: string, language = "typescript", numbered = true) =>
    act(() =>
      root.render(
        createElement(HighlightedCodeBlock, {
          code,
          language,
          isIncomplete: true,
          lineNumbers: numbered,
          startLine: 42,
        }),
      ),
    );
  return { container, render };
}

it("keeps complete line DOM while the unfinished line changes", () => {
  const first = result("const first = 1;\nconst second");
  const next = result("const first = 1;\nconst second = 2;");
  next.tokens[0] = first.tokens[0];
  vi.spyOn(boundedCode, "highlight")
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(next);
  const { container, render } = setup();
  render("const first = 1;\nconst second");
  const line = container.querySelector("pre code")?.firstElementChild;
  if (!line) throw new Error("Missing highlighted line");
  const observer = new MutationObserver(() => {});
  observer.observe(line, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  render("const first = 1;\nconst second = 2;");
  expect(container.querySelector("pre code")?.firstElementChild).toBe(line);
  expect(observer.takeRecords()).toEqual([]);
  expect(container.querySelector("pre code")?.textContent).toContain(
    "const second = 2;",
  );
  observer.disconnect();
});

it("ignores an old highlight result after a new source arrives", () => {
  const callbacks: Array<(value: HighlightResult) => void> = [];
  vi.spyOn(boundedCode, "highlight").mockImplementation(
    (_options, callback) => {
      if (callback) callbacks.push(callback);
      return null;
    },
  );
  const { container, render } = setup();
  render("old");
  render("new");
  act(() => callbacks[0](result("old")));
  expect(container.querySelector("pre code")?.textContent).toBe("new");
  act(() => callbacks[1](result("new")));
  expect(container.querySelector(".markdown-code-token")?.textContent).toBe(
    "new",
  );
});

it("preserves blank lines and the requested line number offset", () => {
  vi.spyOn(boundedCode, "highlight").mockReturnValue(result("a\n\nb"));
  const { container, render } = setup();
  render("a\n\nb");
  const code = container.querySelector("pre code") as HTMLElement;
  expect(code.style.counterReset).toBe("line 41");
  expect(code.querySelectorAll(".markdown-code-numbered-line")).toHaveLength(3);
  expect(code.children[1].textContent).toBe("\n");
  render("a\n\nb", "typescript", false);
  expect(code.style.counterReset).toBe("");
  expect(code.querySelectorAll(".markdown-code-numbered-line")).toHaveLength(0);
});
