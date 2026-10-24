import { expect, it } from "vitest";
import { snapshotFromRuntime, repairSessionSnapshot } from "@/modules/spaces/lib/sessionSnapshot";

it("round-trips the bounded lazy Harness envelope without requiring an outer Harness tab", () => {
  const harness = { version: 1 as const, payload: JSON.stringify({ workspace: {}, views: [] }) };
  const snapshot = snapshotFromRuntime({
    harness, workspaceContexts: [], activeWorkspaceContextId: null,
    tabs: [], activeTabId: 0, viewSpaces: [], stripEntries: [], activeStripItem: null,
  });
  expect(repairSessionSnapshot(JSON.parse(JSON.stringify(snapshot))).harness).toEqual(harness);
  const { harness: _harness, ...legacy } = snapshot;
  expect(repairSessionSnapshot(legacy)).not.toHaveProperty("harness");
  expect(repairSessionSnapshot({ ...legacy, harness: { version: 2, payload: "" } } as unknown as typeof snapshot))
    .not.toHaveProperty("harness");
});
