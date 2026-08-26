import { describe, expect, it } from "vitest";
import { problemSoundCue } from "./events";

describe("semantic sound events", () => {
  it("prioritizes the most important diagnostic severity", () => {
    expect(
      problemSoundCue({
        errors: 1,
        warnings: 4,
        information: 2,
        hints: 3,
        total: 10,
      }),
    ).toBe("error");
    expect(
      problemSoundCue({
        errors: 0,
        warnings: 1,
        information: 2,
        hints: 3,
        total: 6,
      }),
    ).toBe("warning");
    expect(
      problemSoundCue({
        errors: 0,
        warnings: 0,
        information: 1,
        hints: 3,
        total: 4,
      }),
    ).toBe("info");
    expect(
      problemSoundCue({
        errors: 0,
        warnings: 0,
        information: 0,
        hints: 1,
        total: 1,
      }),
    ).toBe("select");
  });

  it("does not emit a cue for an empty workspace", () => {
    expect(
      problemSoundCue({
        errors: 0,
        warnings: 0,
        information: 0,
        hints: 0,
        total: 0,
      }),
    ).toBeNull();
  });
});
