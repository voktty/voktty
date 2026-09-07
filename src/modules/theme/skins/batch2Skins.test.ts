import { describe, expect, it } from "vitest";
import { cubeStepSkin } from "./cubestep/cubeStepSkin";
import { yellowTabOsSkin } from "./yellowtab-os/yellowTabOsSkin";
import { solarCdeSkin } from "./solar-cde/solarCdeSkin";
import { humanity2006Skin } from "./humanity-2006/humanity2006Skin";
import { cubeStepTheme } from "../themes/cubeStepTheme";
import { yellowTabOsTheme } from "../themes/yellowTabOsTheme";
import { solarCdeTheme } from "../themes/solarCdeTheme";
import { humanity2006Theme } from "../themes/humanity2006Theme";
import { validateSkinCss } from "./skinLoader";
import { resolveStructuralTraits } from "../resolveStructuralTraits";
import { getBuiltinTheme, listBuiltinThemes } from "../themes";
import { getSkin } from "./skinRegistry";

describe("Batch 2 Legendary Workstation & Unix Desktop Skins", () => {
  it("registers all Batch 2 skins in skinRegistry", () => {
    expect(getSkin("cubestep")).toBeDefined();
    expect(getSkin("yellowtab-os")).toBeDefined();
    expect(getSkin("solar-cde")).toBeDefined();
    expect(getSkin("humanity-2006")).toBeDefined();
  });

  it("registers all Batch 2 themes in themes catalog", () => {
    expect(getBuiltinTheme("cubestep")).toBe(cubeStepTheme);
    expect(getBuiltinTheme("yellowtab-os")).toBe(yellowTabOsTheme);
    expect(getBuiltinTheme("solar-cde")).toBe(solarCdeTheme);
    expect(getBuiltinTheme("humanity-2006")).toBe(humanity2006Theme);

    const all = listBuiltinThemes();
    expect(all.some((t) => t.id === "cubestep")).toBe(true);
    expect(all.some((t) => t.id === "yellowtab-os")).toBe(true);
    expect(all.some((t) => t.id === "solar-cde")).toBe(true);
    expect(all.some((t) => t.id === "humanity-2006")).toBe(true);
  });

  describe("CubeStep", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("cubestep", cubeStepSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="cubestep"] header');
      expect(scopedCss).toContain('[data-theme-skin="cubestep"] .window-title');
    });

    it("resolves authentic structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: cubeStepTheme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("0px");
      expect(resolved.traits.windowCorners).toBe("square");
    });
  });

  describe("YellowTab OS", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("yellowtab-os", yellowTabOsSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="yellowtab-os"] header');
      expect(scopedCss).toContain('[data-theme-skin="yellowtab-os"] .window-title');
    });

    it("resolves BeOS structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: yellowTabOsTheme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("2px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("Solar Workstation", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("solar-cde", solarCdeSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="solar-cde"] header');
      expect(scopedCss).toContain('[data-theme-skin="solar-cde"] .window-title');
    });

    it("resolves CDE workstation structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: solarCdeTheme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("0px");
      expect(resolved.traits.windowCorners).toBe("square");
    });
  });

  describe("Humanity 2006", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("humanity-2006", humanity2006Skin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="humanity-2006"] header');
      expect(scopedCss).toContain('[data-theme-skin="humanity-2006"] .window-title');
    });

    it("resolves GNOME 2 structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: humanity2006Theme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("3px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });
});
