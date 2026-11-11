import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MatchText } from "./MatchText";

it("marks matched characters with a foreground token, not the accent surface", () => {
  const markup = renderToStaticMarkup(
    createElement(MatchText, { text: "index.php", positions: [0, 1], active: true }),
  );
  expect(markup).toContain("text-[var(--accent-indicator)]");
  expect(markup).not.toMatch(/class="text-accent"/);
  expect(markup.replace(/<[^>]+>/g, "")).toBe("index.php");
});
