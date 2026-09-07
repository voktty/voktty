import { describe, expect, it } from "vitest";
import { commanderBlueSkin } from "./commander-blue/commanderBlueSkin";
import { phosphorCrtSkin } from "./phosphor-crt/phosphorCrtSkin";
import { whistlerBlissSkin } from "./whistler-bliss/whistlerBlissSkin";
import { boingWorkbenchSkin } from "./boing-workbench/boingWorkbenchSkin";
import { commanderBlueTheme } from "../themes/commanderBlueTheme";
import { phosphorCrtTheme } from "../themes/phosphorCrtTheme";
import { whistlerBlissTheme } from "../themes/whistlerBlissTheme";
import { boingWorkbenchTheme } from "../themes/boingWorkbenchTheme";
import { validateSkinCss } from "./skinLoader";
import { resolveStructuralTraits } from "../resolveStructuralTraits";
import { getBuiltinTheme, listBuiltinThemes } from "../themes";
import { getSkin } from "./skinRegistry";

describe("Batch 1 Classic & Terminal Skins", () => {
  it("registers all Batch 1 skins in skinRegistry", () => {
    expect(getSkin("commander-blue")).toBeDefined();
    expect(getSkin("phosphor-crt")).toBeDefined();
    expect(getSkin("whistler-bliss")).toBeDefined();
    expect(getSkin("boing-workbench")).toBeDefined();
  });

  it("registers all Batch 1 themes in themes catalog", () => {
    expect(getBuiltinTheme("commander-blue")).toBe(commanderBlueTheme);
    expect(getBuiltinTheme("phosphor-crt")).toBe(phosphorCrtTheme);
    expect(getBuiltinTheme("whistler-bliss")).toBe(whistlerBlissTheme);
    expect(getBuiltinTheme("boing-workbench")).toBe(boingWorkbenchTheme);

    const all = listBuiltinThemes();
    expect(all.some((t) => t.id === "commander-blue")).toBe(true);
    expect(all.some((t) => t.id === "phosphor-crt")).toBe(true);
    expect(all.some((t) => t.id === "whistler-bliss")).toBe(true);
    expect(all.some((t) => t.id === "boing-workbench")).toBe(true);
  });

  describe("Commander Blue", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("commander-blue", commanderBlueSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="commander-blue"] header');
      expect(scopedCss).toContain('[data-theme-skin="commander-blue"] .window-title');
      expect(scopedCss).toContain('[data-theme-skin="commander-blue"] .window-controls');
    });

    it("resolves authentic structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: commanderBlueTheme });
      expect(resolved.traits.elevationStyle).toBe("flat");
      expect(resolved.traits.pillRadius).toBe("0px");
      expect(resolved.traits.windowCorners).toBe("square");
    });
  });

  describe("Phosphor CRT", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("phosphor-crt", phosphorCrtSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="phosphor-crt"] header');
      expect(scopedCss).toContain('[data-theme-skin="phosphor-crt"] .window-title');
    });

    it("resolves CRT structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: phosphorCrtTheme });
      expect(resolved.traits.elevationStyle).toBe("soft");
      expect(resolved.traits.pillRadius).toBe("2px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("Whistler Bliss", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("whistler-bliss", whistlerBlissSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="whistler-bliss"] header');
      expect(scopedCss).toContain('[data-theme-skin="whistler-bliss"] .window-control-button-close');
    });

    it("resolves Y2K beveled structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: whistlerBlissTheme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("4px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("Boing Workbench", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("boing-workbench", boingWorkbenchSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="boing-workbench"] header');
      expect(scopedCss).toContain('[data-theme-skin="boing-workbench"] .window-title');
    });

    it("resolves 1985 workstation structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: boingWorkbenchTheme });
      expect(resolved.traits.elevationStyle).toBe("flat");
      expect(resolved.traits.pillRadius).toBe("0px");
      expect(resolved.traits.windowCorners).toBe("square");
    });
  });
});
