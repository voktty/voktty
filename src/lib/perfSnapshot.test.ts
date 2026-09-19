import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatPerfSnapshot,
  type PerfSnapshotInput,
} from "./perfSnapshot";

const base: PerfSnapshotInput = {
  terminal: {
    poolSize: 9,
    webglContexts: 4,
    idleSlots: 1,
    sessionCount: 12,
    ringBytesTotal: 2 * 1024 * 1024,
    snapshotCharsTotal: 500_000,
    domCanvases: 8,
    jsHeapBytes: 380 * 1024 * 1024,
  },
  editor: {
    mountedPanes: 20,
    visiblePanes: 1,
    dirtyPanes: 2,
    documentBytes: 4 * 1024 * 1024,
    largestDocumentBytes: 3 * 1024 * 1024,
    domEditors: 20,
  },
  lsp: { sessions: 2, totalDocuments: 20, totalRefs: 20 },
};

describe("formatBytes", () => {
  it("keeps small values in bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales through the binary units", () => {
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GiB");
  });

  it("drops the decimal once the number is wide enough", () => {
    expect(formatBytes(64 * 1024)).toBe("64 KiB");
  });

  it("reports a missing heap reading rather than zero", () => {
    expect(formatBytes(null)).toBe("n/a");
    expect(formatBytes(Number.NaN)).toBe("n/a");
  });
});

describe("formatPerfSnapshot", () => {
  it("reports every counter the editor decision depends on", () => {
    const report = formatPerfSnapshot(base);
    expect(report).toContain("live sessions:     12");
    expect(report).toContain("webgl contexts:    4");
    expect(report).toContain("mounted panes:     20 (1 visible, 2 dirty)");
    expect(report).toContain("document text:     4.0 MiB");
    expect(report).toContain("references:        20");
    expect(report).toContain("4.0 MiB");
  });

  it("omits optional identity lines when absent", () => {
    const report = formatPerfSnapshot(base);
    expect(report).not.toContain("version:");
    expect(report).not.toContain("platform:");
  });

  it("includes identity lines when supplied", () => {
    const report = formatPerfSnapshot({
      ...base,
      appVersion: "1.0.13",
      platform: "windows",
    });
    expect(report).toContain("version: 1.0.13");
    expect(report).toContain("platform: windows");
  });

  it("surfaces an unavailable heap reading instead of failing", () => {
    const report = formatPerfSnapshot({
      ...base,
      terminal: { ...base.terminal, jsHeapBytes: null },
    });
    expect(report).toContain("[js heap]            n/a");
  });
});
