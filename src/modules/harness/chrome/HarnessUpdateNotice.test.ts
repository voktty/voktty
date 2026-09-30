import { describe, expect, it, vi } from "vitest";
import { runUpdate } from "./HarnessUpdateNotice";
import type { HarnessUpdate } from "../lib/harnessUpdates";

let installed = "2.1.284 (Claude Code)";
vi.mock("../lib/harness/child", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/harness/child")>();
  return {
    ...actual,
    inspectHarnessBinary: vi.fn(async () => ({
      path: "/bin/claude",
      version: installed,
    })),
    updateHarnessCli: vi.fn(async () => {
      installed = "2.1.285 (Claude Code)";
    }),
  };
});

const refreshHarnessCatalogs = vi.fn(async () => undefined);
vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: (...args: unknown[]) =>
    refreshHarnessCatalogs(...(args as [])),
}));

const emit = vi.fn(async (_event: string, _payload: unknown) => {});
vi.mock("@tauri-apps/api/event", () => ({
  emit: (event: string, payload: unknown) => emit(event, payload),
  listen: vi.fn(async () => () => {}),
}));

describe("HarnessUpdateNotice runUpdate", () => {
  it("updates CLI and reports updated state when target version is reached", async () => {
    const update: HarnessUpdate = {
      harness: "claude",
      installed: "2.1.284",
      latest: "2.1.285",
    };

    const result = await runUpdate(update);
    expect(result).toEqual({ status: "updated", version: "2.1.285" });
    expect(refreshHarnessCatalogs).toHaveBeenCalledWith(["claude"], {
      force: true,
    });
    expect(emit).toHaveBeenCalledWith("harness-updated", {
      harness: "claude",
      source: expect.any(String),
    });
  });

  it("reports failure when CLI remains on older version after update", async () => {
    installed = "2.1.284 (Claude Code)";
    const { updateHarnessCli } = await import("../lib/harness/child");
    vi.mocked(updateHarnessCli).mockImplementationOnce(async () => {
      // no-op, simulate failed install
    });

    const update: HarnessUpdate = {
      harness: "claude",
      installed: "2.1.284",
      latest: "2.1.285",
    };

    const result = await runUpdate(update);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("Still on 2.1.284 after updating.");
    }
  });
});
