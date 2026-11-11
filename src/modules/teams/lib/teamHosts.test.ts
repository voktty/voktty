import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition, AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import type { SshConnection } from "@/modules/ssh/types";
import {
  assertSafeRemotePath,
  parseAgentHost,
  readTeamHosts,
  removeTeamHostMapping,
  resolveHostForAgent,
  saveTeamHostMapping,
  writeTeamHosts,
} from "./teamHosts";
import { TEAM_HOSTS_SCHEMA } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockFiles = new Map<string, string>();
vi.mock("@/modules/harness/lib/fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const content = mockFiles.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    mockFiles.set(path, content);
  }),
}));

describe("teamHosts", () => {
  describe("parseAgentHost", () => {
    it("handles undefined or 'local' as local", () => {
      expect(parseAgentHost(undefined)).toEqual({ kind: "local" });
      expect(parseAgentHost("local")).toEqual({ kind: "local" });
      expect(parseAgentHost("")).toEqual({ kind: "local" });
      expect(parseAgentHost("  local  ")).toEqual({ kind: "local" });
    });

    it("parses valid ssh hosts with alias", () => {
      expect(parseAgentHost("ssh:prod")).toEqual({ kind: "ssh", alias: "prod" });
      expect(parseAgentHost("ssh:gpu-cluster_1.aws")).toEqual({
        kind: "ssh",
        alias: "gpu-cluster_1.aws",
      });
    });

    it("rejects invalid schemes or aliases", () => {
      expect(parseAgentHost("http://localhost")).toMatchObject({ kind: "invalid" });
      expect(parseAgentHost("docker:container")).toMatchObject({ kind: "invalid" });
      expect(parseAgentHost("ssh:")).toMatchObject({ kind: "invalid" });
      expect(parseAgentHost("ssh:bad/slash")).toMatchObject({ kind: "invalid" });
      expect(parseAgentHost("ssh:bad\\path")).toMatchObject({ kind: "invalid" });
      expect(parseAgentHost("ssh:..")).toMatchObject({ kind: "invalid" });
      expect(parseAgentHost(123 as unknown as string)).toMatchObject({ kind: "invalid" });
    });
  });

  describe("assertSafeRemotePath", () => {
    it("accepts valid absolute POSIX remote paths", () => {
      expect(() => assertSafeRemotePath("/srv/app")).not.toThrow();
      expect(() => assertSafeRemotePath("/home/user/project")).not.toThrow();
      expect(() => assertSafeRemotePath("/var/www/site")).not.toThrow();
    });

    it("rejects path traversal attempts", () => {
      expect(() => assertSafeRemotePath("/srv/app/../secrets")).toThrow("strictly forbidden");
      expect(() => assertSafeRemotePath("/../etc/passwd")).toThrow("strictly forbidden");
      expect(() => assertSafeRemotePath("/srv/..")).toThrow("strictly forbidden");
    });

    it("rejects non-absolute or malformed paths", () => {
      expect(() => assertSafeRemotePath("relative/path")).toThrow("absolute path");
      expect(() => assertSafeRemotePath("/srv/app\0injected")).toThrow("null bytes");
      expect(() => assertSafeRemotePath("C:\\Windows")).toThrow("forward slashes");
    });
  });

  describe("readTeamHosts & writeTeamHosts", () => {
    it("reads empty state when hosts.json does not exist", async () => {
      mockFiles.clear();
      const state = await readTeamHosts("/mock/project");
      expect(state.$schema).toBe(TEAM_HOSTS_SCHEMA);
      expect(state.hosts).toEqual({});
    });

    it("persists host mappings without leaking credentials or tokens", async () => {
      mockFiles.clear();
      const dirtyState = {
        $schema: TEAM_HOSTS_SCHEMA,
        version: 1 as const,
        updatedAt: new Date().toISOString(),
        hosts: {
          server1: {
            connectionId: "conn-123",
            remoteProjectPath: "/srv/project-1",
            password: "leaked-secret-password",
            privateKey: "-----BEGIN RSA PRIVATE KEY-----",
            token: "leaked-auth-token",
            agentToken: "leaked-agent-token",
          } as unknown as { connectionId: string },
        },
      };

      await writeTeamHosts("/mock/project", dirtyState);
      const filePath = "/mock/project/.voktty/state/hosts.json";
      const savedRaw = mockFiles.get(filePath)!;
      expect(savedRaw).toBeDefined();

      // Ensure forbidden strings were never written to disk
      expect(savedRaw).not.toContain("leaked-secret-password");
      expect(savedRaw).not.toContain("BEGIN RSA PRIVATE KEY");
      expect(savedRaw).not.toContain("leaked-auth-token");
      expect(savedRaw).not.toContain("leaked-agent-token");

      const readBack = await readTeamHosts("/mock/project");
      expect(readBack.hosts.server1).toEqual({
        connectionId: "conn-123",
        remoteProjectPath: "/srv/project-1",
      });
      expect((readBack.hosts.server1 as Record<string, unknown>).password).toBeUndefined();
    });

    it("saves and removes team host mapping", async () => {
      mockFiles.clear();
      await saveTeamHostMapping(
        "/mock/project",
        "gpu-node",
        "conn-gpu-id",
        "/data/models/weights",
      );

      let hosts = await readTeamHosts("/mock/project");
      expect(hosts.hosts["gpu-node"]).toEqual({
        connectionId: "conn-gpu-id",
        remoteProjectPath: "/data/models/weights",
      });

      await removeTeamHostMapping("/mock/project", "gpu-node");
      hosts = await readTeamHosts("/mock/project");
      expect(hosts.hosts["gpu-node"]).toBeUndefined();
    });
  });

  describe("resolveHostForAgent", () => {
    const mockConnections: SshConnection[] = [
      {
        id: "conn-uuid-1",
        name: "servidor-prod",
        host: "prod.example.com",
        port: 22,
        user: "deployer",
      },
      {
        id: "staging-direct-id",
        name: "staging",
        host: "staging.example.com",
        port: 2222,
        user: "developer",
      },
    ];

    const roster: AgentRoster = {
      version: 1,
      agents: [
        {
          name: "local-dev",
          role: "developer",
          start: "on-demand",
          host: "local",
        },
        {
          name: "remote-worker",
          role: "worker",
          start: "on-demand",
          host: "ssh:prod",
        },
        {
          name: "remote-unconfigured",
          role: "worker",
          start: "on-demand",
          host: "ssh:nonexistent-host",
        },
      ],
    };

    it("resolves local host", async () => {
      const agent = roster.agents[0];
      const res = await resolveHostForAgent(agent, roster, "/mock/project", mockConnections);
      expect(res).toEqual({ kind: "local" });
    });

    it("resolves unconfigured host when mapping and connection missing", async () => {
      mockFiles.clear();
      const agent = roster.agents[2];
      const res = await resolveHostForAgent(agent, roster, "/mock/project", mockConnections);
      expect(res.kind).toBe("unconfigured");
      if (res.kind === "unconfigured") {
        expect(res.alias).toBe("nonexistent-host");
        expect(res.reason).toContain("not configured on this machine");
      }
    });

    it("resolves configured host via hosts.json mapping", async () => {
      mockFiles.clear();
      await saveTeamHostMapping("/mock/project", "prod", "conn-uuid-1", "/srv/my-repo");

      const agent = roster.agents[1];
      const res = await resolveHostForAgent(agent, roster, "/mock/project", mockConnections);
      expect(res.kind).toBe("ssh");
      if (res.kind === "ssh") {
        expect(res.alias).toBe("prod");
        expect(res.connectionId).toBe("conn-uuid-1");
        expect(res.remoteProjectPath).toBe("/srv/my-repo");
        expect(res.sessionCwd).toBe("remote://voktty-ssh-conn-uuid-1/srv/my-repo");
      }
    });

    it("resolves configured host via direct connection name match", async () => {
      mockFiles.clear();
      const agent: AgentDefinition = {
        name: "staging-worker",
        role: "worker",
        start: "on-demand",
        host: "ssh:staging",
      };

      const res = await resolveHostForAgent(agent, roster, "/mock/project", mockConnections);
      expect(res.kind).toBe("ssh");
      if (res.kind === "ssh") {
        expect(res.alias).toBe("staging");
        expect(res.connectionId).toBe("staging-direct-id");
        expect(res.sessionCwd).toBe("remote://voktty-ssh-staging-direct-id/");
      }
    });

    it("rejects path traversal in mapping configuration", async () => {
      mockFiles.clear();
      const malformedState = {
        $schema: TEAM_HOSTS_SCHEMA,
        version: 1 as const,
        updatedAt: new Date().toISOString(),
        hosts: {
          prod: {
            connectionId: "conn-uuid-1",
            remoteProjectPath: "/srv/app/../outside",
          },
        },
      };
      mockFiles.set(
        "/mock/project/.voktty/state/hosts.json",
        JSON.stringify(malformedState),
      );

      const agent = roster.agents[1];
      const res = await resolveHostForAgent(agent, roster, "/mock/project", mockConnections);
      expect(res.kind).toBe("invalid");
      if (res.kind === "invalid") {
        expect(res.reason).toContain("strictly forbidden");
      }
    });
  });
});
