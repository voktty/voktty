import { describe, expect, it } from "vitest";
import {
  type EditorProbe,
  editorDebugStats,
  registerEditorProbe,
  summarizeEditorProbes,
} from "./editorInstrumentation";

function probe(over: Partial<EditorProbe> & { editorId: number }): EditorProbe {
  return {
    path: "/tmp/a.ts",
    workspaceKey: "local",
    docChars: 0,
    dirty: false,
    status: "ready",
    visible: false,
    ...over,
  };
}

describe("summarizeEditorProbes", () => {
  it("reports zeroes for an empty pool", () => {
    const stats = summarizeEditorProbes([], 0);
    expect(stats.mountedPanes).toBe(0);
    expect(stats.documentBytes).toBe(0);
    expect(stats.largestDocumentBytes).toBe(0);
  });

  it("totals document size and tracks the largest single document", () => {
    const stats = summarizeEditorProbes(
      [
        probe({ editorId: 1, docChars: 100 }),
        probe({ editorId: 2, docChars: 5_000 }),
        probe({ editorId: 3, docChars: 900 }),
      ],
      3,
    );
    expect(stats.mountedPanes).toBe(3);
    expect(stats.documentBytes).toBe(6_000);
    expect(stats.largestDocumentBytes).toBe(5_000);
  });

  it("counts dirty and visible panes independently", () => {
    const stats = summarizeEditorProbes(
      [
        probe({ editorId: 1, dirty: true, visible: true }),
        probe({ editorId: 2, dirty: true, visible: false }),
        probe({ editorId: 3, dirty: false, visible: false }),
      ],
      3,
    );
    expect(stats.dirtyPanes).toBe(2);
    expect(stats.visiblePanes).toBe(1);
  });

  it("does not alias the caller's array", () => {
    const panes = [probe({ editorId: 1 })];
    const stats = summarizeEditorProbes(panes, 1);
    panes.push(probe({ editorId: 2 }));
    expect(stats.panes).toHaveLength(1);
  });
});

describe("registerEditorProbe", () => {
  it("collects registered panes and stops after unregistering", () => {
    const off = registerEditorProbe(41, () =>
      probe({ editorId: 41, docChars: 10 }),
    );
    expect(editorDebugStats().mountedPanes).toBe(1);
    expect(editorDebugStats().documentBytes).toBe(10);
    off();
    expect(editorDebugStats().mountedPanes).toBe(0);
  });

  it("keeps reading the rest when one probe throws", () => {
    const offBad = registerEditorProbe(42, () => {
      throw new Error("mid unmount");
    });
    const offGood = registerEditorProbe(43, () =>
      probe({ editorId: 43, docChars: 7 }),
    );
    const stats = editorDebugStats();
    expect(stats.mountedPanes).toBe(1);
    expect(stats.documentBytes).toBe(7);
    offBad();
    offGood();
  });

  it("a stale unregister does not drop a newer probe for the same id", () => {
    const offFirst = registerEditorProbe(44, () => probe({ editorId: 44 }));
    registerEditorProbe(44, () => probe({ editorId: 44, docChars: 3 }));
    offFirst();
    expect(editorDebugStats().documentBytes).toBe(3);
    registerEditorProbe(44, () => probe({ editorId: 44 }))();
  });
});
