import { describe, expect, it } from "vitest";
import { resolveAppearanceSelection } from "./resolveAppearanceSelection";

describe("resolveAppearanceSelection", () => {
  it("keeps explicit theme controls when the default pack is active", () => {
    expect(
      resolveAppearanceSelection({
        themeId: "mac1",
        variationId: "default",
        appearancePack: "default",
      }),
    ).toMatchObject({ themeId: "mac1", variationId: "default", pack: null });
  });

  it("makes a selected pack resolve its color theme and variation atomically", () => {
    expect(
      resolveAppearanceSelection({
        themeId: "mac1",
        variationId: "default",
        appearancePack: "voktty-liquid",
      }),
    ).toMatchObject({
      themeId: "voktty-default",
      variationId: "liquid",
      pack: { id: "voktty-liquid", materialProfileId: "liquid" },
    });
  });

  it("lets transient previews win without mutating the committed pack", () => {
    expect(
      resolveAppearanceSelection({
        themeId: "mac1",
        variationId: "default",
        appearancePack: "voktty-liquid",
        previewThemeId: "kde",
        previewVariationId: "night",
      }),
    ).toMatchObject({
      themeId: "kde",
      variationId: "night",
      pack: { id: "voktty-liquid" },
    });
  });
});
