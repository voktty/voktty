import { describe, expect, it } from "vitest";
import {
  keybindingCommandLabel,
  keybindingWhenLabel,
  modelSettingDescription,
  modelSettingLabel,
  modelSettingOptionLabel,
  settingsEntryLabel,
  settingsSectionDescription,
  settingsSectionLabel,
} from "./catalogLabels";
import type { ModelSetting } from "./models";
import { KEYBINDINGS, SETTINGS_INDEX } from "./settings";

const t = (key: string) => key;

const reasoning: ModelSetting = {
  id: "reasoningEffort",
  label: "Reasoning",
  kind: "select",
  value: "high",
  options: [
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra High" },
  ],
};

describe("harness catalog labels", () => {
  it("translates stable model-setting labels and options", () => {
    expect(modelSettingLabel(t, reasoning)).toBe("harness.modelSettings.reasoning");
    expect(modelSettingOptionLabel(t, reasoning, reasoning.options[1])).toBe(
      "harness.modelSettings.extraHigh",
    );
  });

  it("preserves labels reported by an unknown catalog", () => {
    const setting: ModelSetting = {
      id: "remote-mode",
      label: "Remote mode",
      kind: "select",
      value: "turbo",
      options: [{ value: "turbo", label: "Turbo" }],
    };

    expect(modelSettingLabel(t, setting)).toBe("Remote mode");
    expect(modelSettingOptionLabel(t, setting, setting.options[0])).toBe("Turbo");
  });

  it("translates harness settings sections", () => {
    expect(settingsSectionLabel(t, "keybindings")).toBe(
      "harness.modelSettings.keybindings",
    );
    expect(settingsSectionDescription(t, "archive")).toBe(
      "harness.modelSettings.sectionDescriptions.archive",
    );
  });

  it("covers every visible keybinding and settings search label", () => {
    for (const row of KEYBINDINGS) {
      expect(keybindingCommandLabel(t, row.command)).toMatch(
        /^harness\.keybindings\.commands\./,
      );
    }
    expect(keybindingWhenLabel(t, "Always")).toBe("harness.keybindings.always");
    expect(keybindingWhenLabel(t, "!editorFocus")).toBe("!editorFocus");
    for (const entry of SETTINGS_INDEX) {
      expect(settingsEntryLabel(t, entry.id)).toMatch(
        /^harness\.settingsEntries\./,
      );
    }
    expect(
      modelSettingDescription(t, {
        id: "fast",
        label: "Fast",
        kind: "toggle",
        value: "false",
        description: "raw",
        options: [],
      }),
    ).toBe("harness.modelSettings.fastDescription");
  });
});
