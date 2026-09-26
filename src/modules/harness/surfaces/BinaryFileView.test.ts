import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BinaryFileView } from "./BinaryFileView";

describe("BinaryFileView", () => {
  it("renders loading placeholder initially", () => {
    const html = renderToStaticMarkup(
      createElement(BinaryFileView, {
        path: "/repo/art/image.png",
        cwd: "/repo",
      }),
    );
    expect(html).toContain("Opening image.png…");
  });
});
