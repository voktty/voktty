import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptySession } from "./EmptySession";

describe("empty session background", () => {
  it("renders the Voktty signal when no chat background is selected", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, { cwd: "/work/demo" }),
    );

    expect(markup).toContain("data-harness-signal");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("<canvas");
    expect(markup).not.toContain("take control");
  });

  it("does not render the signal over a selected chat background", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
        hasChatBackground: true,
      }),
    );

    expect(markup).not.toContain("data-harness-signal");
  });
});
