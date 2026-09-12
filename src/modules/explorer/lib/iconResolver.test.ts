import { describe, expect, it } from "vitest";
import { fileIconUrl, folderIconUrl } from "./iconResolver";

describe("iconResolver", () => {
  it("renders synchronous fallbacks while the icon catalog loads", () => {
    expect(fileIconUrl("unknown.extension")).toMatch(/^data:image\/svg\+xml/);
    expect(folderIconUrl("unknown-folder", false)).toMatch(/^data:image\/svg\+xml/);
    expect(folderIconUrl("unknown-folder", true)).toMatch(/^data:image\/svg\+xml/);
  });
});
