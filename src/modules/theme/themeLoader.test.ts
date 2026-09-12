import { describe, expect, it } from "vitest";
import {
  getLoadedBuiltinTheme,
  getLoadedDefaultTheme,
  loadBuiltinTheme,
} from "./themeLoader";

describe("themeLoader", () => {
  it("keeps a synchronous default before the catalog is requested", () => {
    expect(getLoadedDefaultTheme()).toMatchObject({
      id: "voktty-default",
      defaultVariation: "default",
    });
  });

  it("loads and caches a requested legacy variation", async () => {
    const theme = await loadBuiltinTheme("nord");
    expect(theme.variations?.[0]?.variants.dark?.colors?.background).toBe("#2e3440");
    expect(getLoadedBuiltinTheme("voktty-default")?.variations?.[0]?.id).toBe("nord");
  });

  it("uses the deterministic default for an unknown saved id", async () => {
    await expect(loadBuiltinTheme("removed-theme")).resolves.toMatchObject({
      id: "voktty-default",
    });
  });
});
