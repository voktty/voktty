import { describe, expect, it } from "vitest";
import { resolveRelativeDocPath } from "./lib/pathUtils";

describe("Markdown path resolution", () => {
  it("resolves relative images and documents in the same folder", () => {
    const doc = "C:/proyectos/my-repo/README.md";
    expect(resolveRelativeDocPath(doc, "logo-splash.svg")).toBe(
      "C:/proyectos/my-repo/logo-splash.svg",
    );
    expect(resolveRelativeDocPath(doc, "voktty-project-doctor")).toBe(
      "C:/proyectos/my-repo/voktty-project-doctor",
    );
  });

  it("handles relative subdirectories and parent traversals", () => {
    const doc = "/workspace/sub/doc.md";
    expect(resolveRelativeDocPath(doc, "./assets/img.png")).toBe(
      "/workspace/sub/assets/img.png",
    );
    expect(resolveRelativeDocPath(doc, "../logo.svg")).toBe(
      "/workspace/logo.svg",
    );
  });
});
