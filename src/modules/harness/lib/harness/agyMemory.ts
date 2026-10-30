export function inspectAgyMemoryResult(
  result: Record<string, unknown>,
  expectedConversationId: string | undefined,
  previousTurns: number,
): { completedTurns: number; acceptedConversationId: string | null } {
  const count = result.num_turns;
  const validCount =
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  const id = result.conversation_id;
  const validId =
    typeof id === "string" &&
    id.length <= 4096 &&
    id.trim().length > 0 &&
    id === id.trim() &&
    !/\p{Cc}/u.test(id);
  return {
    completedTurns: validCount ? Math.max(previousTurns, count) : previousTurns,
    acceptedConversationId:
      result.status === "SUCCESS" &&
      validId &&
      (expectedConversationId === undefined || id === expectedConversationId) &&
      validCount &&
      count > previousTurns
        ? id
        : null,
  };
}
