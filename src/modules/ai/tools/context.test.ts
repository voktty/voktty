import { expect, it } from "vitest";
import { resolvePath } from "@/modules/ai/tools/context";

it.each(["C:/fixture", "C:\\fixture", "\\\\fixture-server\\share\\folder"])(
  "preserves an absolute UNC destination from native directory %s",
  (directory) => {
    const path = "\\\\fixture-server\\share\\file.ts";
    expect(resolvePath(path, directory)).toBe(path);
  },
);

it("retains literal backslashes in a POSIX filename", () => {
  const path = "\\\\literal\\name.ts";
  expect(resolvePath(path, "/fixture")).toBe(`/fixture/${path}`);
});
