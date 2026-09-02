import { invoke } from "@tauri-apps/api/core";

export type StoredCursorToolCall = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export function readStoredCursorToolCalls(
  sessionId: string,
  toolCallIds: string[],
): Promise<StoredCursorToolCall[]> {
  return invoke<StoredCursorToolCall[]>("cursor_tool_calls", {
    sessionId,
    toolCallIds,
  });
}
