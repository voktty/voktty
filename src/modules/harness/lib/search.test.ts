import { describe, expect, it } from "vitest";
import { editorPathsEqual, normalizeEditorPath } from "./search";

describe("normalizeEditorPath", () => {
  it("converts Windows backslashes to forward slashes", () => {
    expect(normalizeEditorPath("C:\\Users\\dev\\project\\src\\App.tsx")).toBe(
      "C:/Users/dev/project/src/App.tsx",
    );
  });

  it("removes trailing slashes", () => {
    expect(normalizeEditorPath("src/components///")).toBe("src/components");
    expect(normalizeEditorPath("C:\\Users\\dev\\project\\")).toBe(
      "C:/Users/dev/project",
    );
  });

  it("preserves single root slash or simple names", () => {
    expect(normalizeEditorPath("/")).toBe("/");
    expect(normalizeEditorPath("App.tsx")).toBe("App.tsx");
  });
});

describe("editorPathsEqual", () => {
  it("compares paths ignoring slash direction and trailing slashes", () => {
    expect(
      editorPathsEqual(
        "C:\\Users\\dev\\project\\file.ts",
        "C:/Users/dev/project/file.ts",
      ),
    ).toBe(true);

    expect(
      editorPathsEqual(
        "C:\\Users\\dev\\project/",
        "C:/Users/dev/project",
      ),
    ).toBe(true);

    expect(
      editorPathsEqual(
        "src/components/Button.tsx",
        "src/components/Input.tsx",
      ),
    ).toBe(false);
  });
});
