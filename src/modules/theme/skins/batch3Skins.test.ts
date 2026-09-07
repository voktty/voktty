import { describe, expect, it } from "vitest";
import { pocket89Skin } from "./pocket-89/pocket89Skin";
import { pilotPdaSkin } from "./pilot-pda/pilotPdaSkin";
import { clickWheelPodSkin } from "./clickwheel-pod/clickWheelPodSkin";
import { station94Skin } from "./station-94/station94Skin";
import { pocket89Theme } from "../themes/pocket89Theme";
import { pilotPdaTheme } from "../themes/pilotPdaTheme";
import { clickWheelPodTheme } from "../themes/clickWheelPodTheme";
import { station94Theme } from "../themes/station94Theme";
import { validateSkinCss } from "./skinLoader";
import { resolveStructuralTraits } from "../resolveStructuralTraits";
import { getBuiltinTheme, listBuiltinThemes } from "../themes";
import { getSkin } from "./skinRegistry";

describe("Batch 3 Iconic Retro Handhelds & Consoles", () => {
  it("registers all Batch 3 skins in skinRegistry", () => {
    expect(getSkin("pocket-89")).toBeDefined();
    expect(getSkin("pilot-pda")).toBeDefined();
    expect(getSkin("clickwheel-pod")).toBeDefined();
    expect(getSkin("station-94")).toBeDefined();
  });

  it("registers all Batch 3 themes in themes catalog", () => {
    expect(getBuiltinTheme("pocket-89")).toBe(pocket89Theme);
    expect(getBuiltinTheme("pilot-pda")).toBe(pilotPdaTheme);
    expect(getBuiltinTheme("clickwheel-pod")).toBe(clickWheelPodTheme);
    expect(getBuiltinTheme("station-94")).toBe(station94Theme);

    const all = listBuiltinThemes();
    expect(all.some((t) => t.id === "pocket-89")).toBe(true);
    expect(all.some((t) => t.id === "pilot-pda")).toBe(true);
    expect(all.some((t) => t.id === "clickwheel-pod")).toBe(true);
    expect(all.some((t) => t.id === "station-94")).toBe(true);
  });

  describe("Pocket Handheld 89", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("pocket-89", pocket89Skin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="pocket-89"] header');
      expect(scopedCss).toContain('[data-theme-skin="pocket-89"] .window-title');
    });

    it("resolves authentic pixel structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: pocket89Theme });
      expect(resolved.traits.elevationStyle).toBe("flat");
      expect(resolved.traits.pillRadius).toBe("0px");
      expect(resolved.traits.windowCorners).toBe("square");
    });
  });

  describe("Pilot PDA", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("pilot-pda", pilotPdaSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="pilot-pda"] header');
      expect(scopedCss).toContain('[data-theme-skin="pilot-pda"] .window-title');
    });

    it("resolves PDA structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: pilotPdaTheme });
      expect(resolved.traits.elevationStyle).toBe("flat");
      expect(resolved.traits.pillRadius).toBe("3px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("ClickWheel Pod", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("clickwheel-pod", clickWheelPodSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="clickwheel-pod"] header');
      expect(scopedCss).toContain('[data-theme-skin="clickwheel-pod"] .tab-active');
    });

    it("resolves MP3 player structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: clickWheelPodTheme });
      expect(resolved.traits.elevationStyle).toBe("soft");
      expect(resolved.traits.pillRadius).toBe("9999px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("Station 94", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("station-94", station94Skin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="station-94"] header');
      expect(scopedCss).toContain('[data-theme-skin="station-94"] .window-title');
    });

    it("resolves 32-bit console structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: station94Theme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("4px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });
});
