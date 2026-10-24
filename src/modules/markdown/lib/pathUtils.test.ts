import { describe, expect, it } from "vitest";
import { resolveRelativeDocPath } from "./pathUtils";

describe("resolveRelativeDocPath", () => {
  it.each([
    [
      "remote://host/project/docs/readme.md",
      "../src/app.ts",
      "remote://host/project/src/app.ts",
    ],
    [
      "remote://host/project/readme.md",
      "/other/file.ts",
      "remote://host/other/file.ts",
    ],
    [
      "remote://host//server/share/docs/readme.md",
      "../file.ts",
      "remote://host//server/share/file.ts",
    ],
    ["//server/share/docs/readme.md", "../file.ts", "//server/share/file.ts"],
    ["//server/share/readme.md", "../../file.ts", "//server/share/file.ts"],
    [
      "remote://host/project/readme.md",
      "C:/native/file.ts",
      "C:/native/file.ts",
    ],
    [
      "remote://host/project/readme.md",
      "\\\\server\\share\\file.ts",
      "\\\\server\\share\\file.ts",
    ],
  ])(
    "preserves the path owner resolving %s and %s",
    (base, relative, expected) => {
      expect(resolveRelativeDocPath(base, relative)).toBe(expected);
    },
  );
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
