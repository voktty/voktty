// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "@/modules/ai/lib/native";
import { useWebProjectKind, type WebProjectInfo } from "./useWebProjectKind";

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    readDir: vi.fn(),
  },
}));

const entry = (name: string, kind: "file" | "dir" = "file") => ({
  name,
  kind,
  gitignored: false,
  size: 100,
  mtime: 1000,
});

let root: Root;
let node: HTMLDivElement;
let currentInfo: WebProjectInfo | null = null;

function HarnessProjectViewer({ folder }: { folder: string | null }) {
  const info = useWebProjectKind(folder);
  currentInfo = info;
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  currentInfo = null;
  node = document.createElement("div");
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("useWebProjectKind dynamic detection", () => {
  it("probes and detects a static HTML project immediately", async () => {
    vi.mocked(native.readDir).mockResolvedValueOnce([
      entry("index.html", "file"),
      entry("style.css", "file"),
    ]);

    await act(async () => {
      root.render(<HarnessProjectViewer folder="/work/my-site" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(currentInfo).toEqual({ kind: "static", docroot: "." });
  });

  it("probes and detects a PHP project", async () => {
    vi.mocked(native.readDir).mockResolvedValueOnce([
      entry("index.php", "file"),
    ]);

    await act(async () => {
      root.render(<HarnessProjectViewer folder="/work/php-site" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(currentInfo).toEqual({ kind: "php", docroot: "." });
  });

  it("detects web project inside public directory if top-level has no entry file", async () => {
    vi.mocked(native.readDir)
      .mockResolvedValueOnce([
        entry("public", "dir"),
        entry("package.json", "file"),
      ])
      .mockResolvedValueOnce([
        entry("index.html", "file"),
      ]);

    await act(async () => {
      root.render(<HarnessProjectViewer folder="/work/vite-site" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(currentInfo).toEqual({ kind: "static", docroot: "public" });
  });

  it("dynamically re-probes and proposes web project when file-saved event occurs", async () => {
    // 1. Initial read: empty folder -> null
    vi.mocked(native.readDir).mockResolvedValueOnce([]);

    await act(async () => {
      root.render(<HarnessProjectViewer folder="/work/dynamic-project" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(currentInfo).toBeNull();

    // 2. Next probe returns newly created index.html
    vi.mocked(native.readDir).mockResolvedValueOnce([
      entry("index.html", "file"),
    ]);

    // Dispatch event indicating files were saved
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("voktty:file-saved", {
          detail: { path: "/work/dynamic-project/index.html" },
        }),
      );
      await Promise.resolve();
    });

    expect(currentInfo).toEqual({ kind: "static", docroot: "." });
  });

  it("dynamically re-probes and detects web project during development polling", async () => {
    // Initial read: empty
    vi.mocked(native.readDir).mockResolvedValueOnce([]);

    await act(async () => {
      root.render(<HarnessProjectViewer folder="/work/polling-project" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(currentInfo).toBeNull();

    // AI agent writes index.php during development
    vi.mocked(native.readDir).mockResolvedValueOnce([
      entry("index.php", "file"),
    ]);

    // Advance polling timer
    await act(async () => {
      vi.advanceTimersByTime(2600);
      await Promise.resolve();
    });

    expect(currentInfo).toEqual({ kind: "php", docroot: "." });
  });
});
