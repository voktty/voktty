import { tool } from "ai";
import { z } from "zod";
import { fetchMessages, fetchSessions } from "@/modules/agent-history";
import type { ToolContext } from "./context";

export function buildAgentHistoryTools(_ctx: ToolContext) {
  return {
    history_search_sessions: tool({
      description:
        "Search through historical AI agent conversations (Voktty, Claude Code, Codex, Cursor) to find past solutions, code implementations, debugging sessions, or project contexts using SQLite full-text search (FTS5).",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search term or keywords (e.g. 'OAuth2 token refresh', 'fix Prisma connection')"),
        agent: z
          .enum(["all", "claude", "codex", "cursor", "voktty"])
          .optional()
          .describe("Optional agent filter (defaults to 'all')"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of session results to return (max 20)"),
      }),
      execute: async ({ query, agent, limit }) => {
        try {
          const sessions = await fetchSessions({
            search_query: query,
            agent: agent && agent !== "all" ? agent : undefined,
            limit: Math.min(limit || 10, 20),
          });

          if (sessions.length === 0) {
            return {
              status: "empty",
              message: `No agent sessions found matching query: "${query}"`,
              results: [],
            };
          }

          return {
            status: "success",
            total_found: sessions.length,
            results: sessions.map((s) => ({
              id: s.id,
              agent: s.agent,
              title: s.title,
              project_name: s.project_name,
              project_path: s.project_path,
              cwd: s.cwd,
              message_count: s.message_count,
              date: s.updated_at ? new Date(s.updated_at * 1000).toISOString() : "unknown",
            })),
          };
        } catch (err) {
          return {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    }),

    history_get_session_summary: tool({
      description:
        "Retrieve the sanitized conversation transcript of a specific past agent session by its ID. Redacts sensitive keys and credentials for security.",
      inputSchema: z.object({
        session_id: z
          .string()
          .describe("The session ID returned by history_search_sessions (e.g. 'claude_abc123', 'codex_xyz')"),
        max_messages: z
          .number()
          .optional()
          .default(30)
          .describe("Maximum messages to retrieve from the transcript (default 30)"),
      }),
      execute: async ({ session_id, max_messages }) => {
        try {
          const messages = await fetchMessages(session_id, 0, Math.min(max_messages || 30, 100));

          if (messages.length === 0) {
            return {
              status: "empty",
              session_id,
              message: "No messages found for this session ID",
            };
          }

          return {
            status: "success",
            session_id,
            total_messages: messages.length,
            transcript: messages.map((m) => ({
              role: m.role,
              content: m.content.slice(0, 1000), // Bound size per message
              tool_name: m.tool_name,
              is_error: m.is_error,
              redacted: m.redacted,
            })),
          };
        } catch (err) {
          return {
            status: "error",
            session_id,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    }),
  };
}