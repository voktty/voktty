import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition, AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import type { SshConnection } from "@/modules/ssh/types";
import {
  assertSafeRemotePath,
  type NativeHostRecord,
  parseAgentHost,
  readTeamHosts,
  removeTeamHostMapping,
  resolveHostForAgent,
  saveTeamHostMapping,
  writeTeamHosts,
} from "./teamHosts";
import { TEAM_HOSTS_SCHEMA } from "../types";

// In-memory native store to simulate Rust app_data_dir/team_hosts.json
const nativeStore = new Map<string, NativeHostRecord>();

const mockInvoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
  if (cmd === "team_save_host_mapping") {
    const projectPath = args.projectPath as string;
    const alias = (args.alias as string).toLowerCase();
    const connectionId = args.connectionId as string;
    const remotePath = args.remotePath as string;
    const key = `${projectPath}::${alias}`;
    nativeStore.set(key, {
      canonical_project: projectPath,
      alias,
      connection_id: connectionId,
      remote_path: remotePath,
      updated_at: new Date().toISOString(),
    });
    return;
  }
  if (cmd === "team_remove_host_mapping") {
    const projectPath = args.projectPath as string;
    const alias = (args.alias as string).toLowerCase();
    nativeStore.delete(`${projectPath}::${alias}`);
    return;
  }
  if (cmd === "team_read_host_mappings") {
    const projectPath = args.projectPath as string;
    const result: Record<string, NativeHostRecord> = {};
    for (const [key, record] of nativeStore.entries()) {
      if (key.startsWith(`${projectPath}::`)) {
        result[record.alias] = record;
      }
    }
    return result;
  }
  if (cmd === "team_get_host_mapping") {
    const projectPath = args.projectPath as string;
    const alias = (args.alias as string).toLowerCase();
    return nativeStore.get(`${projectPath}::${alias}`) ?? null;
  }
  return null;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => mockInvoke(cmd, args),
}));

describe("teamHosts", () => {
  beforeEach(() => {
    nativeStore.clear();
    mockInvoke.mockClear();
  });

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
      expect(() => assertSafeRemotePath("/")).toThrow("cannot be the root directory ('/')");
      expect(() => assertSafeRemotePath("")).toThrow("must be a non-empty string");
      expect(() => assertSafeRemotePath("   ")).toThrow("must be a non-empty string");
    });
  });

  describe("native host mappings via Rust (S4)", () => {
    it("reads empty state when no native mappings exist", async () => {
      const state = await readTeamHosts("/mock/project");
      expect(state.$schema).toBe(TEAM_HOSTS_SCHEMA);
      expect(state.hosts).toEqual({});
      expect(mockInvoke).toHaveBeenCalledWith("team_read_host_mappings", {
        projectPath: "/mock/project",
      });
    });

    it("saves and removes team host mapping via native Rust commands", async () => {
      await saveTeamHostMapping(
        "/mock/project",
        "gpu-node",
        "conn-gpu-id",
        "/data/models/weights",
      );

      expect(mockInvoke).toHaveBeenCalledWith("team_save_host_mapping", {
        projectPath: "/mock/project",
        alias: "gpu-node",
        connectionId: "conn-gpu-id",
        remotePath: "/data/models/weights",
      });

      let hosts = await readTeamHosts("/mock/project");
      expect(hosts.hosts["gpu-node"]).toEqual({
        connectionId: "conn-gpu-id",
        remoteProjectPath: "/data/models/weights",
      });

      await removeTeamHostMapping("/mock/project", "gpu-node");
      expect(mockInvoke).toHaveBeenCalledWith("team_remove_host_mapping", {
        projectPath: "/mock/project",
        alias: "gpu-node",
      });

      hosts = await readTeamHosts("/mock/project");
      expect(hosts.hosts["gpu-node"]).toBeUndefined();
    });

    it("rejects empty remote project path and root directory '/' (R1)", async () => {
      await expect(
        saveTeamHostMapping("/mock/project", "gpu-node", "conn-gpu-id", ""),
      ).rejects.toThrow("Remote project path is required");

      await expect(
        saveTeamHostMapping("/mock/project", "gpu-node", "conn-gpu-id", "   "),
      ).rejects.toThrow("Remote project path is required");

      await expect(
        saveTeamHostMapping("/mock/project", "gpu-node", "conn-gpu-id", "/"),
      ).rejects.toThrow("cannot be the root directory ('/')");
    });

    it("writeTeamHosts delegates to native store without writing to workspace disk (S4)", async () => {
      await writeTeamHosts("/mock/project", {
        $schema: TEAM_HOSTS_SCHEMA,
        version: 1,
        updatedAt: new Date().toISOString(),
        hosts: {
          server1: {
            connectionId: "conn-123",
            remoteProjectPath: "/srv/project-1",
          },
        },
      });

      const hosts = await readTeamHosts("/mock/project");
      expect(hosts.hosts.server1).toEqual({
        connectionId: "conn-123",
        remoteProjectPath: "/srv/project-1",
      });
    });
  });

  describe("resolveHostForAgent (S4 security invariant)", () => {
    const mockConnections: SshConnection[] = [
      {
        id: "conn-uuid-1",
        name: "Production Server",
        host: "prod.example.com",
        port: 22,
        user: "admin",
        authType: "auto",
      },
      {
        id: "direct-alias",
        name: "Direct Node",
        host: "direct.example.com",
        port: 22,
        user: "root",
        authType: "auto",
        initialDirectory: "/srv/direct-project",
      },
    ];

    const baseRoster: AgentRoster = {
      $schema: "urn:voktty:agent-roster:1",
      version: 1,
      agents: [],
    };

    it("resolves local host immediately", async () => {
      const agent: AgentDefinition = {
        name: "local-dev",
        role: "developer",
        start: "on-demand",
        host: "local",
      };
      const res = await resolveHostForAgent(agent, baseRoster, "/proj", mockConnections);
      expect(res).toEqual({ kind: "local" });
    });

    it("CRITICAL (S4): workspace hosts.json file NEVER overrides native host mapping", async () => {
      // Attacker attempts to redirect 'gpu-server' by forging a mapping
      // Because resolveHostForAgent reads native Rust store exclusively,
      // an unmapped alias returns 'unconfigured' even if workspace files exist
      const agent: AgentDefinition = {
        name: "attacker-target",
        role: "worker",
        start: "on-demand",
        host: "ssh:gpu-server",
      };

      const res = await resolveHostForAgent(agent, baseRoster, "/proj", mockConnections);
      expect(res.kind).toBe("unconfigured");
      if (res.kind === "unconfigured") {
        expect(res.alias).toBe("gpu-server");
      }
    });

    it("resolves from native Rust store linked by the owner", async () => {
      // Legitimate owner configuration
      await saveTeamHostMapping("/proj", "gpu-server", "conn-uuid-1", "/srv/ml-model");

      const agent: AgentDefinition = {
        name: "model-runner",
        role: "worker",
        start: "on-demand",
        host: "ssh:gpu-server",
      };

      const res = await resolveHostForAgent(agent, baseRoster, "/proj", mockConnections);
      expect(res.kind).toBe("ssh");
      if (res.kind === "ssh") {
        expect(res.alias).toBe("gpu-server");
        expect(res.connectionId).toBe("conn-uuid-1");
        expect(res.remoteProjectPath).toBe("/srv/ml-model");
        expect(res.sessionCwd).toBe("remote://voktty-ssh-conn-uuid-1/srv/ml-model");
      }
    });

    it("falls back to connection matching alias name directly", async () => {
      const agent: AgentDefinition = {
        name: "direct-runner",
        role: "worker",
        start: "on-demand",
        host: "ssh:direct-alias",
      };

      const res = await resolveHostForAgent(agent, baseRoster, "/proj", mockConnections);
      expect(res.kind).toBe("ssh");
      if (res.kind === "ssh") {
        expect(res.alias).toBe("direct-alias");
        expect(res.connectionId).toBe("direct-alias");
        expect(res.remoteProjectPath).toBe("/srv/direct-project");
      }
    });

    it("returns invalid when remote path is malicious", async () => {
      // Malicious path in native mapping
      nativeStore.set("/proj::bad-node", {
        canonical_project: "/proj",
        alias: "bad-node",
        connection_id: "conn-uuid-1",
        remote_path: "/srv/bad/../etc",
        updated_at: new Date().toISOString(),
      });

      const agent: AgentDefinition = {
        name: "exploit",
        role: "worker",
        start: "on-demand",
        host: "ssh:bad-node",
      };

      const res = await resolveHostForAgent(agent, baseRoster, "/proj", mockConnections);
      expect(res.kind).toBe("invalid");
    });
  });
});
