import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWorkspaceMock } = vi.hoisted(() => ({
  invokeWorkspaceMock: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  invokeWorkspace: invokeWorkspaceMock,
}));

import { editorPathsEqual, normalizeEditorPath, searchProject } from "./search";

beforeEach(() => {
  invokeWorkspaceMock.mockReset().mockResolvedValue({
    matches: [],
    truncated: false,
  });
});

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
      editorPathsEqual("C:\\Users\\dev\\project/", "C:/Users/dev/project"),
    ).toBe(true);

    expect(
      editorPathsEqual("src/components/Button.tsx", "src/components/Input.tsx"),
    ).toBe(false);
  });
});

it("routes project search through the remote-aware workspace runner", async () => {
  const options = { cwd: "remote://voktty-ssh-profile/srv/app", query: "foo" };

  await searchProject(options);

  expect(invokeWorkspaceMock).toHaveBeenCalledWith("search_project", {
    options,
  });
});
