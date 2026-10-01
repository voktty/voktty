import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpSettings } from "./McpSettings";
import { clearMcpSettingsCache } from "../mcp";

const invoke = vi.hoisted(() => vi.fn());
const ask = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "harness.mcp.serversConfigured") {
        return `${params?.count ?? 0} configured`;
      }
      return key;
    },
  }),
}));

describe("McpSettings", () => {
  beforeEach(() => {
    clearMcpSettingsCache();
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? [
            {
              provider: "claude",
              name: "sentry",
              scope: "user",
              configPath: "/home/.claude.json",
              transport: "http",
            },
            {
              provider: "codex",
              name: "docs",
              scope: "user",
              configPath: "/home/.codex/config.toml",
              transport: "http",
            },
          ]
        : undefined,
    );
  });

  it("renders McpSettings shell and project header in static markup", () => {
    const markup = renderToStaticMarkup(
      createElement(McpSettings, {
        cwd: "/test/project",
      }),
    );

    expect(markup).toContain("MCP connections");
    expect(markup).toContain("Add MCP server");
    expect(markup).toContain("Refresh");
    expect(markup).toContain("All");
  });

  it("renders with custom recents list", () => {
    const markup = renderToStaticMarkup(
      createElement(McpSettings, {
        cwd: "/test/project",
        recents: [{ path: "/test/project", openedAt: Date.now() }],
      }),
    );

    expect(markup).toContain("MCP connections");
    expect(markup).toContain("project");
  });
});
