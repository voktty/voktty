import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createParentOf } from "../lib/fileTree";
import { dragPointToClient } from "../lib/dragPoint";
import { FileTree } from "./FileTree";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

describe("FileTree rendering & drag drop helpers", () => {
  it("renders the root folder tree header", () => {
    const markup = renderToStaticMarkup(
      createElement(FileTree, {
        cwd: "/test/project",
        onOpenFile: vi.fn(),
      }),
    );
    expect(markup).toContain("project");
  });

  it("calculates destination parent for files vs folders", async () => {
    // When no cache exists, defaults to parent of selected
    expect(createParentOf("/test/project", "/test/project/src/index.ts")).toBe(
      "/test/project/src",
    );
    expect(createParentOf("/test/project", "/test/project")).toBe(
      "/test/project",
    );
  });

  it("correctly converts drag points with DPI scaling", () => {
    expect(dragPointToClient(100, 200, true, 2)).toEqual({ x: 50, y: 100 });
    expect(dragPointToClient(100, 200, false, 2)).toEqual({ x: 100, y: 200 });
  });
});
