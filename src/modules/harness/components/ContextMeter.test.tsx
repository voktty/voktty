import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ContextMeter } from "./ContextMeter";

describe("ContextMeter", () => {
  it("renders percentage and tokens correctly", () => {
    const markup = renderToStaticMarkup(<ContextMeter used={40000} window={200000} />);
    expect(markup).toContain("20%");
    expect(markup).toContain("<svg");
  });

  it("handles 0 tokens used", () => {
    const markup = renderToStaticMarkup(<ContextMeter used={0} window={100000} />);
    expect(markup).toContain("0%");
  });

  it("handles 100% capacity", () => {
    const markup = renderToStaticMarkup(<ContextMeter used={200000} window={200000} />);
    expect(markup).toContain("100%");
  });
});
