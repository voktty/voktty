import { describe, expect, it } from "vitest";
import {
  canExtractWorkspaceDrag,
  shouldActivateWorkspaceDrag,
} from "./workspaceDrag";

describe("shouldActivateWorkspaceDrag", () => {
  it("only exposes extraction for members of a composite space", () => {
    expect(
      canExtractWorkspaceDrag({
        kind: "standalone-tab",
        tabId: 1,
        tabKey: "tab-1" as never,
      }),
    ).toBe(false);
    expect(
      canExtractWorkspaceDrag({
        kind: "space-member",
        tabId: 1,
        tabKey: "tab-1" as never,
        viewSpaceId: "view-main" as never,
        slotId: null,
      }),
    ).toBe(true);
  });

  it("keeps horizontal tab reordering separate from workspace drops", () => {
    expect(shouldActivateWorkspaceDrag("y", 40, 3)).toBe(false);
    expect(shouldActivateWorkspaceDrag("y", 40, 8)).toBe(false);
    expect(shouldActivateWorkspaceDrag("y", 40, 24)).toBe(true);
  });

  it("keeps vertical tab reordering separate from workspace drops", () => {
    expect(shouldActivateWorkspaceDrag("x", 3, 40)).toBe(false);
    expect(shouldActivateWorkspaceDrag("x", 8, 40)).toBe(false);
    expect(shouldActivateWorkspaceDrag("x", 24, 40)).toBe(true);
  });

  it("preserves radial activation for explorer resources", () => {
    expect(shouldActivateWorkspaceDrag("any", 3, 2)).toBe(false);
    expect(shouldActivateWorkspaceDrag("any", 3, 3)).toBe(true);
  });
});
