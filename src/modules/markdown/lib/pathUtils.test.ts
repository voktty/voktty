import { describe, expect, it } from "vitest";
import { resolveRelativeDocPath } from "./pathUtils";

describe("resolveRelativeDocPath", () => {
  it("resolves sibling files", () => {
    const base = "C:/Users/user/.voktty/extensions/README.md";
    const rel = "logo-splash.svg";
    expect(resolveRelativeDocPath(base, rel)).toBe(
      "C:/Users/user/.voktty/extensions/logo-splash.svg",
    );
  });

  it("resolves subfolder relative paths", () => {
    const base = "C:/Users/user/.voktty/extensions/README.md";
    const rel = "voktty-project-doctor";
    expect(resolveRelativeDocPath(base, rel)).toBe(
      "C:/Users/user/.voktty/extensions/voktty-project-doctor",
    );
  });

  it("resolves parent relative paths", () => {
    const base = "/home/user/project/docs/guide.md";
    const rel = "../images/diagram.png";
    expect(resolveRelativeDocPath(base, rel)).toBe(
      "/home/user/project/images/diagram.png",
    );
  });

  it("leaves external URLs untouched", () => {
    const base = "C:/repo/README.md";
    const rel = "https://github.com/voktty/voktty";
    expect(resolveRelativeDocPath(base, rel)).toBe(
      "https://github.com/voktty/voktty",
    );
  });

  it("leaves data URIs untouched", () => {
    const base = "C:/repo/README.md";
    const dataUri = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    expect(resolveRelativeDocPath(base, dataUri)).toBe(dataUri);
  });
});
