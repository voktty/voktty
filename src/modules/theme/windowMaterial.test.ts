import { describe, expect, it } from "vitest";
import { resolveWindowMaterial, type WindowMaterial } from "./windowMaterial";

const ALL: WindowMaterial[] = ["mica", "mica-alt", "acrylic"];
const theme = (variationId: string | null, dark: boolean, skinId?: string) => ({
  variationId,
  dark,
  skinId,
});

describe("resolveWindowMaterial", () => {
  it.each(["default", "fluent", "tokyo-night", "catppuccin", "rose-pine", "dracula", "kanagawa", "liquid"])(
    "gives the dark %s variation Acrylic",
    (id) => expect(resolveWindowMaterial("auto", theme(id, true), ALL)).toBe("acrylic"),
  );

  it.each(["nord", "solarized", "gruvbox", "everforest", "claude", "xcode", "kanagawa-dragon"])(
    "keeps Mica for %s",
    (id) => expect(resolveWindowMaterial("auto", theme(id, true), ALL)).toBe("mica"),
  );

  it("uses Mica in light mode, Acrylic themes included", () => {
    expect(resolveWindowMaterial("auto", theme("fluent", false), ALL)).toBe("mica");
  });

  it("keeps period skins opaque unless the user picks a material", () => {
    expect(resolveWindowMaterial("auto", theme("default", true, "win31"), ALL)).toBe("none");
    expect(resolveWindowMaterial("acrylic", theme("default", true, "win31"), ALL)).toBe("acrylic");
  });

  it("honours an explicit choice over the theme", () => {
    expect(resolveWindowMaterial("mica-alt", theme("tokyo-night", true), ALL)).toBe("mica-alt");
  });

  it("falls back to Mica, then opaque, when Windows cannot paint the choice", () => {
    expect(resolveWindowMaterial("acrylic", theme("nord", true), ["mica"])).toBe("mica");
    expect(resolveWindowMaterial("auto", theme("tokyo-night", true), ["mica"])).toBe("mica");
    expect(resolveWindowMaterial("acrylic", theme("nord", true), [])).toBe("none");
  });
});
