import { expect, it } from "vitest";
import {
  applyConflictResolutions,
  parseConflictMarkers,
  type ConflictResolution,
} from "@/modules/source-control/lib/conflictMarkers";

it.each<ConflictResolution>(["ours", "theirs", "both", "base"])(
  "resolves large line cohorts without argument spreading (%s)",
  (choice) => {
    const prefix = "p\n".repeat(150000);
    const suffix = "q\n".repeat(150000);
    const ours = "o\n".repeat(150000);
    const base = "b\n".repeat(150000);
    const theirs = "t\n".repeat(150000);
    const original = `${prefix}<<<<<<< HEAD\n${ours}||||||| base\n${base}=======\n${theirs}>>>>>>> feature\n${suffix}`;
    const selected =
      choice === "ours"
        ? ours
        : choice === "theirs"
          ? theirs
          : choice === "base"
            ? base
            : ours + theirs;
    expect(
      applyConflictResolutions(
        parseConflictMarkers(original),
        new Map([[0, choice]]),
      ),
    ).toBe(prefix + selected + suffix);
  },
);
