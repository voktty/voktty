import type { HistoryMessage } from "../types";

export type MessageSearchResult = {
  messageIds: string[];
  total: number;
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
  if (!needle) return { messageIds: [], total: 0 };

  const messageIds: string[] = [];
  let total = 0;
  for (const message of messages) {
    let messageMatches = 0;
    for (const value of searchableFields(message)) {
      const normalizedValue = value?.toLocaleLowerCase() ?? "";
      let index = normalizedValue.indexOf(needle);
      while (index >= 0) {
        messageMatches += 1;
        index = normalizedValue.indexOf(needle, index + needle.length);
      }
    }
    if (messageMatches > 0) messageIds.push(message.id);
    total += messageMatches;
  }
  return { messageIds, total };
}
