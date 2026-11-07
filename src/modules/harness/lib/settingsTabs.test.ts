import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "./settings";
import { settingsTabForSection } from "./settingsTabs";

describe("settingsTabForSection", () => {
  it("maps every legacy Harness section to a general settings tab", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(settingsTabForSection(section.id)).toBeTruthy();
    }
  });

  it("defaults to the Harness tab", () => {
    expect(settingsTabForSection(undefined)).toBe("harness");
  });

  it("sends project-bound sections to the projects tab", () => {
    expect(settingsTabForSection("worktrees")).toBe("projects");
    expect(settingsTabForSection("archive")).toBe("projects");
  });
});
