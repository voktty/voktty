import { describe, expect, it } from "vitest";
import { searchHistoryMessages } from "./messageSearch";
import type { HistoryMessage } from "../types";

const message: HistoryMessage = {
  id: "one", session_id: "session", role: "assistant", content: "Fix the OAuth flow", sequence: 1,
  timestamp: 0, tool_name: "read_file", tool_input: "oauth.ts", tool_output: null, is_error: false, redacted: false,
};

describe("searchHistoryMessages", () => {
  it("searches the canonical transcript fields without DOM nodes", () => {
    expect(searchHistoryMessages([message, { ...message, id: "two", content: "No match", thinking: "OAuth OAuth" }], "oauth"))
      .toEqual({ messageIds: ["one", "two"] });
  });

  it("returns no matches for an empty query", () => {
    expect(searchHistoryMessages([message], " ")).toEqual({ messageIds: [] });
  });
});
