import { describe, expect, it } from "vitest";
import { audioAmpClassicSkin } from "./audioamp-classic/audioAmpClassicSkin";
import { cyberCafe99Skin } from "./cybercafe-99/cyberCafe99Skin";
import { tigerAquaSkin } from "./tiger-aqua/tigerAquaSkin";
import { mediaStation9Skin } from "./media-station-9/mediaStation9Skin";
import { instantChat7Skin } from "./instant-chat-7/instantChat7Skin";
import { bbsDialupSkin } from "./bbs-dialup/bbsDialupSkin";

import { audioAmpClassicTheme } from "../themes/audioAmpClassicTheme";
import { cyberCafe99Theme } from "../themes/cyberCafe99Theme";
import { tigerAquaTheme } from "../themes/tigerAquaTheme";
import { mediaStation9Theme } from "../themes/mediaStation9Theme";
import { instantChat7Theme } from "../themes/instantChat7Theme";
import { bbsDialupTheme } from "../themes/bbsDialupTheme";

import { validateSkinCss } from "./skinLoader";
import { resolveStructuralTraits } from "../resolveStructuralTraits";
import { getBuiltinTheme, listBuiltinThemes } from "../themes";
import { getSkin } from "./skinRegistry";

describe("Batch 4 Multimedia, Cyberpunk & Internet Golden Age", () => {
  it("registers all Batch 4 skins in skinRegistry", () => {
    expect(getSkin("audioamp-classic")).toBeDefined();
    expect(getSkin("cybercafe-99")).toBeDefined();
    expect(getSkin("tiger-aqua")).toBeDefined();
    expect(getSkin("media-station-9")).toBeDefined();
    expect(getSkin("instant-chat-7")).toBeDefined();
    expect(getSkin("bbs-dialup")).toBeDefined();
  });

  it("registers all Batch 4 themes in themes catalog", () => {
    expect(getBuiltinTheme("audioamp-classic")).toBe(audioAmpClassicTheme);
    expect(getBuiltinTheme("cybercafe-99")).toBe(cyberCafe99Theme);
    expect(getBuiltinTheme("tiger-aqua")).toBe(tigerAquaTheme);
    expect(getBuiltinTheme("media-station-9")).toBe(mediaStation9Theme);
    expect(getBuiltinTheme("instant-chat-7")).toBe(instantChat7Theme);
    expect(getBuiltinTheme("bbs-dialup")).toBe(bbsDialupTheme);

    const all = listBuiltinThemes();
    expect(all.some((t) => t.id === "audioamp-classic")).toBe(true);
    expect(all.some((t) => t.id === "cybercafe-99")).toBe(true);
    expect(all.some((t) => t.id === "tiger-aqua")).toBe(true);
    expect(all.some((t) => t.id === "media-station-9")).toBe(true);
    expect(all.some((t) => t.id === "instant-chat-7")).toBe(true);
    expect(all.some((t) => t.id === "bbs-dialup")).toBe(true);
  });

  describe("AudioAMP Classic", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("audioamp-classic", audioAmpClassicSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="audioamp-classic"] header');
      expect(scopedCss).toContain('[data-theme-skin="audioamp-classic"] .window-title');
    });

    it("resolves media player structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: audioAmpClassicTheme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("2px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("CyberCafe 99", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("cybercafe-99", cyberCafe99Skin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="cybercafe-99"] header');
      expect(scopedCss).toContain('[data-theme-skin="cybercafe-99"] .window-title');
    });

    it("resolves cybercafe structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: cyberCafe99Theme });
      expect(resolved.traits.elevationStyle).toBe("bevel");
      expect(resolved.traits.pillRadius).toBe("0px");
      expect(resolved.traits.windowCorners).toBe("square");
    });
  });

  describe("Tiger Aqua", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("tiger-aqua", tigerAquaSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="tiger-aqua"] header');
      expect(scopedCss).toContain('[data-theme-skin="tiger-aqua"] .tab-active');
    });

    it("resolves Aqua jelly structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: tigerAquaTheme });
      expect(resolved.traits.elevationStyle).toBe("soft");
      expect(resolved.traits.pillRadius).toBe("9999px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("Media Station 9", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("media-station-9", mediaStation9Skin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="media-station-9"] header');
      expect(scopedCss).toContain('[data-theme-skin="media-station-9"] .window-title');
    });

    it("resolves cobalt player structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: mediaStation9Theme });
      expect(resolved.traits.elevationStyle).toBe("soft");
      expect(resolved.traits.pillRadius).toBe("9999px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("Instant Chat 7", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("instant-chat-7", instantChat7Skin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="instant-chat-7"] header');
      expect(scopedCss).toContain('[data-theme-skin="instant-chat-7"] .window-title');
    });

    it("resolves instant chat structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: instantChat7Theme });
      expect(resolved.traits.elevationStyle).toBe("soft");
      expect(resolved.traits.pillRadius).toBe("8px");
      expect(resolved.traits.windowCorners).toBe("round");
    });
  });

  describe("BBS Dial-Up", () => {
    it("validates skin CSS scoping without syntax errors", () => {
      const { valid, errors, scopedCss } = validateSkinCss("bbs-dialup", bbsDialupSkin.css);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(scopedCss).toContain('[data-theme-skin="bbs-dialup"] header');
      expect(scopedCss).toContain('[data-theme-skin="bbs-dialup"] .window-title');
    });

    it("resolves ASCII BBS structural traits", () => {
      const resolved = resolveStructuralTraits({ theme: bbsDialupTheme });
      expect(resolved.traits.elevationStyle).toBe("flat");
      expect(resolved.traits.pillRadius).toBe("0px");
      expect(resolved.traits.windowCorners).toBe("square");
    });
  });
});
