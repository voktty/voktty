import { expect, it } from "vitest";
import corpus from "@/../templates/workspace-kit/conformance/handoff-time.json";
import { handoffCreatedAtMs } from "@/modules/workspace-kit/lib/handoff";

it.each(corpus.cases)(
  "shares the native UTC handoff date for $name",
  (test) => {
    expect(handoffCreatedAtMs(test.name)).toBe(test.expected);
  },
);

it("rejects malformed Unicode instead of guessing a creation date", () => {
  expect(handoffCreatedAtMs("2026-01-01-0000-\ud800.md")).toBeNull();
});
