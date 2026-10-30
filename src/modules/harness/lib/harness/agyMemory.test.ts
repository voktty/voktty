import { expect, it } from "vitest";
import { inspectAgyMemoryResult } from "@/modules/harness/lib/harness/agyMemory";

const success = {
  status: "SUCCESS",
  conversation_id: "provider",
  num_turns: 2,
};

it("accepts only an explicit successful result that advances the provider turn count", () => {
  expect(inspectAgyMemoryResult(success, "provider", 1)).toEqual({
    completedTurns: 2,
    acceptedConversationId: "provider",
  });
  expect(inspectAgyMemoryResult(success, undefined, 0)).toEqual({
    completedTurns: 2,
    acceptedConversationId: "provider",
  });
});

it.each([
  { status: undefined },
  { status: "ERROR" },
  { status: "success" },
  { conversation_id: undefined },
  { conversation_id: "" },
  { conversation_id: "   " },
  { conversation_id: " provider " },
  { conversation_id: "other" },
  { conversation_id: "provider\n" },
  { conversation_id: "x".repeat(4097) },
  { num_turns: undefined },
  { num_turns: "2" },
  { num_turns: 0 },
  { num_turns: -1 },
  { num_turns: 1 },
  { num_turns: 1.5 },
  { num_turns: Number.NaN },
  { num_turns: Number.POSITIVE_INFINITY },
  { num_turns: Number.MAX_SAFE_INTEGER + 1 },
])("refuses incomplete, failed, foreign or replayed evidence: %j", (patch) => {
  expect(
    inspectAgyMemoryResult({ ...success, ...patch }, "provider", 1)
      .acceptedConversationId,
  ).toBeNull();
});

it("retains a monotonic observation even when a result cannot confirm memory", () => {
  const failed = inspectAgyMemoryResult(
    { ...success, status: "ERROR" },
    "provider",
    1,
  );
  expect(failed.completedTurns).toBe(2);
  expect(
    inspectAgyMemoryResult(success, "provider", failed.completedTurns)
      .acceptedConversationId,
  ).toBeNull();
  expect(inspectAgyMemoryResult({ num_turns: 1 }, "provider", 2)).toEqual({
    completedTurns: 2,
    acceptedConversationId: null,
  });
});
