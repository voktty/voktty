// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReview } from "./SessionReview";
import type { WebProjectInfo } from "@/modules/preview/lib/useWebProjectKind";
import type { CheckpointFile } from "../lib/checkpoint";

const mockState = vi.hoisted(() => ({
  project: null as WebProjectInfo | null,
  files: [] as CheckpointFile[],
}));

vi.mock("@/modules/preview/lib/useWebProjectKind", () => ({
  useWebProjectKind: () => mockState.project,
}));

vi.mock("../lib/checkpoint", () => ({
  checkpointsAvailable: () => true,
  sessionCheckpointStatus: async () => ({ files: mockState.files }),
  keepSessionChanges: vi.fn(),
  undoSessionChanges: vi.fn(),
  subscribeReviewChanged: () => () => {},
}));

vi.mock("../lib/fs", () => ({
  basename: (p?: string) => (p ? p.split("/").pop() || "" : ""),
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: () => () => {},
}));

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.count !== undefined) return `${params.count} changed files`;
      return key;
    },
  }),
}));

let root: Root;
let node: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockState.project = null;
  mockState.files = [
    {
      path: "/work/landing-page/index.html",
      relative: "index.html",
      status: "added",
      additions: 10,
      deletions: 0,
      exact: true,
      undoable: true,
    },
  ];
  node = document.createElement("div");
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("SessionReview web project preview proposal", () => {
  it("proposes preview when a web project is detected during development", async () => {
    mockState.project = { kind: "static", docroot: "." };
    const previewDispatched = vi.fn();
    window.addEventListener("voktty:open-preview", previewDispatched);

    await act(async () => {
      root.render(
        <SessionReview
          sessionId="session-1"
          cwd="/work/landing-page"
          onOpenDiff={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const previewButton = Array.from(node.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("preview.openPreview"),
    );
    expect(previewButton).toBeDefined();
    expect(previewButton?.textContent).toContain("HTML");

    await act(async () => {
      previewButton?.click();
    });

    expect(previewDispatched).toHaveBeenCalledOnce();
    const event = previewDispatched.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ target: "/work/landing-page" });

    window.removeEventListener("voktty:open-preview", previewDispatched);
  });

  it("does not render preview button when project is not a web project", async () => {
    mockState.project = null;

    await act(async () => {
      root.render(
        <SessionReview
          sessionId="session-1"
          cwd="/work/python-cli"
          onOpenDiff={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const previewButton = Array.from(node.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("preview.openPreview"),
    );
    expect(previewButton).toBeUndefined();
  });
});
