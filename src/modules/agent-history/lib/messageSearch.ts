import type { HistoryMessage } from "../types";

export type MessageSearchResult = {
  messageIds: string[];
};

const searchableFields = (message: HistoryMessage): Array<string | undefined | null> => [
  message.content,
  message.thinking,
  message.tool_name,
  message.tool_input,
  message.tool_output,
];

export function searchHistoryMessages(messages: HistoryMessage[], query: string): MessageSearchResult {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { messageIds: [] };

  const messageIds: string[] = [];
  for (const message of messages) {
    const matches = searchableFields(message).some((value) => {
      const normalizedValue = value?.toLocaleLowerCase() ?? "";
      return normalizedValue.includes(needle);
    });
    if (matches) messageIds.push(message.id);
  }
  return { messageIds };
}
