import { describe, expect, it } from "vitest";
import { rasterizeLogoGrid } from "./logoPixels";

describe("rasterizeLogoGrid", () => {
  it("produces a non-trivial silhouette within grid bounds", () => {
    const grid = 18;
    const cells = rasterizeLogoGrid(grid);
    expect(cells.length).toBeGreaterThan(20);
    expect(cells.length).toBeLessThan(grid * grid * 0.6);
    for (const cell of cells) {
      expect(cell.col).toBeGreaterThanOrEqual(0);
      expect(cell.col).toBeLessThan(grid);
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeLessThan(grid);
    }
  });

  it("only uses the three logo stroke colors", () => {
    const cells = rasterizeLogoGrid(18);
    const colors = new Set(cells.map((c) => c.color));
    expect(colors).toEqual(new Set(["#F8FAFC", "#6366F1", "#10B981"]));
  });

  it("never places two cells at the same position", () => {
    const cells = rasterizeLogoGrid(18);
    const seen = new Set(cells.map((c) => `${c.col}:${c.row}`));
    expect(seen.size).toBe(cells.length);
  });

  it("keeps the left arm on the left half and the right arm on the right half", () => {
    const grid = 18;
    const cells = rasterizeLogoGrid(grid);
    const mid = grid / 2;
    const leftArm = cells.filter((c) => c.color === "#F8FAFC");
    const rightArm = cells.filter((c) => c.color === "#6366F1");
    expect(leftArm.length).toBeGreaterThan(0);
    expect(rightArm.length).toBeGreaterThan(0);
    const avgLeftCol =
      leftArm.reduce((sum, c) => sum + c.col, 0) / leftArm.length;
    const avgRightCol =
      rightArm.reduce((sum, c) => sum + c.col, 0) / rightArm.length;
    expect(avgLeftCol).toBeLessThan(mid);
    expect(avgRightCol).toBeGreaterThan(mid);
  });

  it("scales to a different grid resolution without throwing", () => {
    expect(rasterizeLogoGrid(24).length).toBeGreaterThan(0);
    expect(rasterizeLogoGrid(10).length).toBeGreaterThan(0);
  });
});
