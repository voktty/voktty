import { describe, expect, it } from "vitest";
import { hasCurrentAiHealth, isAiAvailable } from "./availability";

const current = {
  aiEnabled: true,
  aiConfigRevision: 4,
  aiHealthRevision: 4,
  aiHealthCheckedAt: 100,
};

describe("AI availability contract", () => {
  it("requires explicit activation and a current successful health check", () => {
    expect(hasCurrentAiHealth(current)).toBe(true);
    expect(isAiAvailable(current)).toBe(true);
    expect(isAiAvailable({ ...current, aiEnabled: false })).toBe(false);
  });

  it("revokes availability after configuration changes", () => {
    expect(
      isAiAvailable({ ...current, aiConfigRevision: 5, aiEnabled: true }),
    ).toBe(false);
  });

  it("does not accept a revision without a completed check timestamp", () => {
    expect(hasCurrentAiHealth({ ...current, aiHealthCheckedAt: null })).toBe(
      false,
    );
  });
});
