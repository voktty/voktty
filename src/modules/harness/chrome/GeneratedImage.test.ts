import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneratedImage } from "./GeneratedImage";

describe("GeneratedImage", () => {
  it("renders loading state initially during server/static render", () => {
    const markup = renderToStaticMarkup(
      createElement(GeneratedImage, {
        image: {
          path: "/path/to/img.png",
          name: "diagram.png",
          mimeType: "image/png",
          size: 1024,
          alt: "A generated diagram",
        },
      }),
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading generated image");
  });
});
