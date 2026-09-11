import { describe, expect, it, vi } from "vitest";
import {
  createLauncherItems,
  type LauncherActionContext,
} from "./catalog";

describe("createLauncherItems", () => {
  it("contains work surfaces without exposing Settings sections", () => {
    const items = createLauncherItems({
      openConnections: vi.fn(),
      openNewHarness: vi.fn(),
    } as unknown as LauncherActionContext);
    const ids = items.map((item) => item.id);

    expect(ids).toContain("launch.connections");
    expect(ids).toContain("launch.commandHistory");
    expect(ids).toContain("launch.harness");
    expect(ids.some((id) => id.includes("settings"))).toBe(false);
    expect(ids).not.toContain("launch.shortcuts");
    expect(ids).not.toContain("launch.themes");
    expect(ids).not.toContain("launch.models");
    expect(ids).not.toContain("launch.extensions");
    expect(ids).not.toContain("launch.mcp");
    expect(ids).not.toContain("launch.aliases");
    expect(ids).not.toContain("launch.vault");
    expect(ids).not.toContain("launch.about");
  });
});
