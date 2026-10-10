// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";

const fixture = vi.hoisted(() => {
  const cwd = "/test/project";
  const entries = new Map([
    [
      cwd,
      [
        { name: "src", path: `${cwd}/src`, isDir: true, ignored: false },
        {
          name: "first.ts",
          path: `${cwd}/first.ts`,
          isDir: false,
          ignored: false,
        },
        {
          name: "second.ts",
          path: `${cwd}/second.ts`,
          isDir: false,
          ignored: false,
        },
      ],
    ],
    [
      `${cwd}/src`,
      [
        {
          name: "a.ts",
          path: `${cwd}/src/a.ts`,
          isDir: false,
          ignored: false,
        },
      ],
    ],
  ]);
  return { cwd, entries };
});

vi.mock("../lib/fileTree", () => ({
  createParentOf: vi.fn(),
  dirsTouchedByCreate: vi.fn(() => []),
  dirsTouchedByMove: vi.fn(() => []),
  forgetDir: vi.fn(),
  listCachedDir: async (path: string) => fixture.entries.get(path) ?? [],
  loadExpanded: (cwd: string) => new Set([cwd]),
  loadSelected: (cwd: string) => `${cwd}/src`,
  notifyDirsChanged: vi.fn(),
  peekDir: (path: string) => fixture.entries.get(path) ?? null,
  refreshDir: async (path: string) => fixture.entries.get(path) ?? [],
  saveExpanded: vi.fn(),
  saveSelected: vi.fn(),
  subscribeDirsChanged: () => () => {},
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}));

let container: HTMLDivElement;
let root: Root;
const onOpenFile = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(FileTree, {
        cwd: fixture.cwd,
        onOpenFile,
      }),
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onOpenFile.mockReset();
  vi.unstubAllGlobals();
});

function row(path: string): HTMLButtonElement {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.title === path);
  if (!found) throw new Error(`Missing tree row ${path}`);
  return found;
}

async function press(target: HTMLElement, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await Promise.resolve();
  });
}

describe("FileTree keyboard navigation", () => {
  it("moves selection with arrows, Home, and End", async () => {
    await press(row(`${fixture.cwd}/src`), "ArrowDown");
    expect(document.activeElement).toBe(row(`${fixture.cwd}/first.ts`));
    await press(row(`${fixture.cwd}/first.ts`), "End");
    expect(document.activeElement).toBe(row(`${fixture.cwd}/second.ts`));
    await press(row(`${fixture.cwd}/second.ts`), "ArrowUp");
    expect(document.activeElement).toBe(row(`${fixture.cwd}/first.ts`));
    await press(row(`${fixture.cwd}/first.ts`), "Home");
    expect(document.activeElement).toBe(row(fixture.cwd));
  });

  it("expands folders, enters children, and walks back to their parent", async () => {
    const src = `${fixture.cwd}/src`;
    await press(row(src), "ArrowRight");
    expect(row(src).getAttribute("aria-expanded")).toBe("true");
    expect(row(`${src}/a.ts`)).toBeDefined();
    await press(row(src), "ArrowRight");
    expect(document.activeElement).toBe(row(`${src}/a.ts`));
    await press(row(`${src}/a.ts`), "ArrowLeft");
    expect(document.activeElement).toBe(row(src));
    await press(row(src), "ArrowLeft");
    expect(row(src).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens files with Enter and toggles folders", async () => {
    const src = `${fixture.cwd}/src`;
    await press(row(src), "Enter");
    expect(row(src).getAttribute("aria-expanded")).toBe("true");
    await press(row(src), "End");
    const path = `${fixture.cwd}/second.ts`;
    await press(row(path), "Enter");
    expect(onOpenFile).toHaveBeenCalledWith(path, undefined, { exact: true });
  });

  it("cycles matching rows when repeating one letter", async () => {
    const src = `${fixture.cwd}/src`;
    await press(row(src), "s");
    expect(document.activeElement).toBe(row(`${fixture.cwd}/second.ts`));
    await press(row(`${fixture.cwd}/second.ts`), "s");
    expect(document.activeElement).toBe(row(src));
  });

  it("narrows the match as a typed prefix grows", async () => {
    const src = `${fixture.cwd}/src`;
    await press(row(src), "f");
    await press(row(`${fixture.cwd}/first.ts`), "i");
    expect(document.activeElement).toBe(row(`${fixture.cwd}/first.ts`));
  });
});
