import { expect, it } from "vitest";
import { editorGroupRect } from "@/modules/editor/lib/editorGroupRect";

const root = { left: 100, top: 50, width: 1000, height: 500 };
it("normalizes group geometry independently of root offset and viewport scale", () => {
  expect(
    editorGroupRect(root, { left: 600, top: 50, width: 500, height: 500 }),
  ).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  expect(
    editorGroupRect(
      { left: 200, top: 100, width: 2000, height: 1000 },
      { left: 1200, top: 100, width: 1000, height: 1000 },
    ),
  ).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
});
it("clips group rectangles to the owning editor layer", () => {
  expect(
    editorGroupRect(root, { left: 50, top: 0, width: 150, height: 100 }),
  ).toEqual({ x: 0, y: 0, width: 0.1, height: 0.1 });
  expect(
    editorGroupRect(root, { left: 1000, top: 500, width: 200, height: 100 }),
  ).toEqual({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 });
});
it.each([0, -1, NaN, Infinity])(
  "rejects unavailable root dimensions %s",
  (width) => {
    expect(editorGroupRect({ ...root, width }, root)).toBeNull();
  },
);
it("rejects missing, nonfinite and fully clipped slots", () => {
  expect(editorGroupRect(root, { ...root, width: 0 })).toBeNull();
  expect(editorGroupRect(root, { ...root, top: NaN })).toBeNull();
  expect(editorGroupRect(root, { ...root, left: 1200 })).toBeNull();
});
