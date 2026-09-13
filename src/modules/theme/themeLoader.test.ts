import { describe, expect, it } from "vitest";
import {
  getLoadedBuiltinTheme,
  getLoadedDefaultTheme,
  loadBuiltinTheme,
} from "./themeLoader";
import { builtinThemeVariationIds } from "./themeCatalog";

describe("themeLoader", () => {
  it("keeps a synchronous default before the catalog is requested", () => {
    expect(getLoadedDefaultTheme()).toMatchObject({
      id: "voktty-default",
      defaultVariation: "default",
    });
  });

  it("keeps the default variation out of the catalog loader", async () => {
    await expect(loadBuiltinTheme("default")).resolves.toBe(getLoadedDefaultTheme());
  });

  it("loads and caches a requested legacy variation", async () => {
    const theme = await loadBuiltinTheme("nord");
    expect(theme.variations?.[0]?.variants.dark?.colors?.background).toBe("#2e3440");
    expect(getLoadedBuiltinTheme("voktty-default")?.variations?.[0]?.id).toBe("nord");
  });

  it("loads every variation advertised by the selector", async () => {
    await Promise.all(
      builtinThemeVariationIds.map(async (id) => {
        const theme = await loadBuiltinTheme(id);
        const variation = theme.variations?.[0];
        expect(variation?.id).toBe(id);
        if (id !== "default") {
          expect(
            Object.keys(variation?.variants.dark?.colors ?? {}).length +
              Object.keys(variation?.variants.light?.colors ?? {}).length,
          ).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("uses the deterministic default for an unknown saved id", async () => {
    await expect(loadBuiltinTheme("removed-theme")).resolves.toMatchObject({
      id: "voktty-default",
    });
  });
});
