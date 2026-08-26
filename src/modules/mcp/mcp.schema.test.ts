import { describe, expect, it } from "vitest";
import { mcpServerSchema, parseStoredMcpServers } from "./mcp.schema";

describe("MCP server persistence schema", () => {
  it("accepts bounded non-secret HTTP and stdio configuration", () => {
    expect(
      mcpServerSchema.parse({
        id: "local-docs",
        name: "Local docs",
        enabled: false,
        authMode: "none",
        transport: {
          kind: "http",
          endpoint: "http://127.0.0.1:3847/mcp",
          allowPrivateNetwork: true,
        },
      }),
    ).toBeTruthy();
    expect(
      mcpServerSchema.parse({
        id: "workspace-tools",
        name: "Workspace tools",
        enabled: true,
        authMode: "none",
        transport: {
          kind: "stdio",
          executable: "node",
          args: ["server.mjs"],
          cwd: "C:\\workspace",
          authorizedRoot: "C:\\workspace",
        },
      }),
    ).toBeTruthy();
  });

  it("rejects credentials and environment values in persisted configuration", () => {
    const withToken = {
      id: "remote",
      name: "Remote",
      enabled: true,
      authMode: "bearer",
      bearerToken: "must-never-persist",
      transport: {
        kind: "http",
        endpoint: "https://mcp.example.test",
        allowPrivateNetwork: false,
      },
    };
    const withEnvironment = {
      id: "local",
      name: "Local",
      enabled: true,
      authMode: "none",
      transport: {
        kind: "stdio",
        executable: "node",
        args: [],
        cwd: "C:\\workspace",
        authorizedRoot: "C:\\workspace",
        environment: { API_TOKEN: "must-never-persist" },
      },
    };

    expect(mcpServerSchema.safeParse(withToken).success).toBe(false);
    expect(mcpServerSchema.safeParse(withEnvironment).success).toBe(false);
    expect(parseStoredMcpServers([withToken, withEnvironment])).toEqual([]);
  });

  it("drops malformed persisted entries without exceeding the server budget", () => {
    const valid = {
      id: "safe",
      name: "Safe",
      enabled: false,
      authMode: "none",
      transport: {
        kind: "http",
        endpoint: "https://mcp.example.test",
        allowPrivateNetwork: false,
      },
    };

    expect(parseStoredMcpServers([null, valid, { ...valid, id: "unsafe id" }])).toEqual([
      valid,
    ]);
    expect(parseStoredMcpServers(Array.from({ length: 80 }, () => valid))).toHaveLength(64);
  });
});
