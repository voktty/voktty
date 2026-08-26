import { describe, expect, it } from "vitest";
import {
  asTabKey,
  createTabIdentity,
  createTabKey,
  duplicateTabKeys,
  resolveTabKey,
  workspaceScopeIdFromLegacySpace,
} from "./tabIdentity";

describe("tab identity", () => {
  it("creates a stable persistent key independently from the runtime id", () => {
    const tabKey = createTabKey(() => "4f9b95d0-1718-4cc1-a72f-9d56ffda834c");

    expect(tabKey).toBe("tab-4f9b95d0-1718-4cc1-a72f-9d56ffda834c");
  });

  it("keeps a valid hydrated key", () => {
    const persisted = asTabKey("tab-persisted-1");

    expect(resolveTabKey(persisted, () => "unused")).toBe(persisted);
  });

  it("replaces a missing or malformed hydrated key", () => {
    const next = () => "replacement";

    expect(resolveTabKey(undefined, next)).toBe("tab-replacement");
    expect(resolveTabKey("", next)).toBe("tab-replacement");
    expect(resolveTabKey("legacy-id", next)).toBe("tab-replacement");
  });

  it("adapts the legacy space id into an independent workspace scope", () => {
    expect(createTabIdentity("workspace-a", () => "tab-a")).toEqual({
      tabKey: "tab-tab-a",
      workspaceScopeId: workspaceScopeIdFromLegacySpace("workspace-a"),
    });
  });

  it("detects duplicate persistent identities independently from runtime ids", () => {
    const duplicated = asTabKey("tab-shared");

    expect(
      duplicateTabKeys([
        { tabKey: duplicated, id: 1 },
        { tabKey: asTabKey("tab-other"), id: 2 },
        { tabKey: duplicated, id: 3 },
      ]),
    ).toEqual([duplicated]);
  });
});
