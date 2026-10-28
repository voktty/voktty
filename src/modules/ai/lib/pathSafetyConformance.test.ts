import { expect, it } from "vitest";
import cases from "@/lib/pathSafetyConformance.json";
import { checkReadable, checkWritable } from "@/modules/ai/lib/security";

it.each(cases)("shares native path policy for $path", (test) => {
  expect(checkReadable(test.path).ok).toBe(test.readable);
  expect(checkWritable(test.path).ok).toBe(test.writable);
});
