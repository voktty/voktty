import { describe, expect, it } from "vitest";
import { classifyDocumentReadError } from "./useDocument";

describe("classifyDocumentReadError", () => {
  it.each([
    ["The system cannot find the path specified. (os error 3)", "not-found"],
    ["ENOENT: no such file or directory", "not-found"],
    ["Access is denied. (os error 5)", "permission-denied"],
    ["Document read timed out", "offline"],
    ["The network path was not found. (os error 53)", "offline"],
    ["unexpected decoder failure", "unknown"],
  ])("classifies %s", (message, expected) => {
    expect(classifyDocumentReadError(message)).toBe(expected);
  });
});
