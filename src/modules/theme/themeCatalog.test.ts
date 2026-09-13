import { describe, expect, it } from "vitest";
import { builtinThemeCatalog, resolveCatalogTheme } from "./themeCatalog";

describe("themeCatalog", () => {
  it("keeps the full selector catalog available without loading theme tokens", () => {
    expect(builtinThemeCatalog).toHaveLength(22);
    expect(builtinThemeCatalog.find((theme) => theme.id === "voktty-default"))
      .toMatchObject({
        name: "Voktty",
        variations: expect.arrayContaining([
          expect.objectContaining({ id: "default", name: "Obsidian" }),
          expect.objectContaining({ id: "nord", name: "Nord" }),
          expect.objectContaining({ id: "rose-pine", name: "Rosé Pine" }),
        ]),
      });
  });

  it("keeps catalog variations while using loaded tokens for the selected variation", () => {
    const catalog = resolveCatalogTheme("voktty-default", {
      id: "voktty-default",
      name: "Voktty",
      variants: {},
      variations: [{
        id: "nord",
        name: "Nord",
        variants: { dark: { colors: { background: "#2e3440" } } },
      }],
    });

    expect(catalog?.variations).toHaveLength(18);
    expect(catalog?.variations?.find((variation) => variation.id === "nord"))
      .toMatchObject({ variants: { dark: { colors: { background: "#2e3440" } } } });
  });
});
