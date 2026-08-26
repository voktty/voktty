import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTunnelSshCommand,
  formatTunnelDirection,
  type SshTunnelConfig,
} from "./types";
import {
  addSshTunnel,
  deleteSshTunnel,
  updateSshTunnel,
  useLiveTunnelStore,
} from "./tunnelStore";
import { sanitizeSshTunnels } from "@/modules/settings/configExport";
import { usePreferencesStore } from "@/modules/settings/preferences";

const mockStorage = new Map<string, unknown>();

vi.mock("@tauri-apps/plugin-store", () => {
  return {
    LazyStore: class {
      get(key: string) {
        return Promise.resolve(mockStorage.get(key) ?? null);
      }
      set(key: string, value: unknown) {
        mockStorage.set(key, value);
        return Promise.resolve();
      }
      delete(key: string) {
        mockStorage.delete(key);
        return Promise.resolve();
      }
      save() {
        return Promise.resolve();
      }
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "ssh_tunnel_start") {
      return {
        id: (args.config as SshTunnelConfig).id,
        status: "active",
        startedAt: Date.now(),
      };
    }
    if (cmd === "ssh_tunnel_stop" || cmd === "ssh_tunnel_stop_all") {
      return undefined;
    }
    if (cmd === "ssh_tunnel_list") {
      return [];
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

describe("SSH Tunnels Subsystem", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      sshConnections: [
        {
          id: "ssh-conn-1",
          name: "Production Web",
          host: "web.prod.corp",
          port: 2222,
          user: "deploy",
          identityFile: "~/.ssh/id_ed25519",
        },
      ],
      sshTunnels: [],
    });
    useLiveTunnelStore.getState().clearAllActive();
  });

  describe("formatTunnelDirection", () => {
    it("formats local port forwarding", () => {
      const config: SshTunnelConfig = {
        id: "t1",
        name: "MySQL",
        tunnelType: "local",
        localHost: "127.0.0.1",
        localPort: 3307,
        remoteHost: "10.0.0.5",
        remotePort: 3306,
        host: "jump.corp",
      };
      expect(formatTunnelDirection(config)).toBe("127.0.0.1:3307 ➔ 10.0.0.5:3306");
    });

    it("formats remote port forwarding", () => {
      const config: SshTunnelConfig = {
        id: "t2",
        name: "Vite App",
        tunnelType: "remote",
        localHost: "127.0.0.1",
        localPort: 5173,
        remotePort: 8080,
        host: "jump.corp",
      };
      expect(formatTunnelDirection(config)).toBe("Remote :8080 ➔ 127.0.0.1:5173");
    });

    it("formats dynamic SOCKS5 proxy", () => {
      const config: SshTunnelConfig = {
        id: "t3",
        name: "SOCKS5 Proxy",
        tunnelType: "dynamic",
        localHost: "127.0.0.1",
        localPort: 1080,
        host: "jump.corp",
      };
      expect(formatTunnelDirection(config)).toBe("SOCKS5 Proxy on 127.0.0.1:1080");
    });
  });

  describe("buildTunnelSshCommand", () => {
    it("builds exact CLI command for local tunnel", () => {
      const config: SshTunnelConfig = {
        id: "t1",
        name: "Redis",
        tunnelType: "local",
        localHost: "127.0.0.1",
        localPort: 6379,
        remoteHost: "127.0.0.1",
        remotePort: 6379,
        host: "redis.server.com",
        port: 2200,
        user: "admin",
        identityFile: "~/.ssh/id_rsa",
      };
      const cmd = buildTunnelSshCommand(config);
      expect(cmd).toBe("ssh -N -L 127.0.0.1:6379:127.0.0.1:6379 -p 2200 -i \"~/.ssh/id_rsa\" admin@redis.server.com");
    });

    it("builds exact CLI command for remote tunnel with extra args", () => {
      const config: SshTunnelConfig = {
        id: "t2",
        name: "Local Web Exposed",
        tunnelType: "remote",
        localHost: "127.0.0.1",
        localPort: 3000,
        remoteHost: "0.0.0.0",
        remotePort: 9000,
        host: "public.server.com",
        extraArgs: "-v -C",
      };
      const cmd = buildTunnelSshCommand(config);
      expect(cmd).toBe("ssh -N -R 0.0.0.0:9000:127.0.0.1:3000 -v -C public.server.com");
    });

    it("builds dynamic socks5 proxy command", () => {
      const config: SshTunnelConfig = {
        id: "t3",
        name: "SOCKS",
        tunnelType: "dynamic",
        localHost: "127.0.0.1",
        localPort: 1080,
        host: "proxy.node",
        user: "root",
      };
      const cmd = buildTunnelSshCommand(config);
      expect(cmd).toBe("ssh -N -D 127.0.0.1:1080 root@proxy.node");
    });
  });

  describe("Store CRUD and Active State", () => {
    it("adds and persists a new tunnel rule", async () => {
      const created = await addSshTunnel({
        name: "PostgreSQL",
        tunnelType: "local",
        localPort: 5433,
        remotePort: 5432,
        host: "db.server.com",
        user: "postgres",
      });

      expect(created.id).toMatch(/^tun-/);
      expect(created.name).toBe("PostgreSQL");

      const inStore = usePreferencesStore.getState().sshTunnels;
      expect(inStore).toHaveLength(1);
      expect(inStore[0].localPort).toBe(5433);
    });

    it("updates existing tunnel rule", async () => {
      const created = await addSshTunnel({
        name: "Old Name",
        tunnelType: "local",
        localPort: 8080,
        remotePort: 80,
        host: "web.server.com",
      });

      await updateSshTunnel(created.id, {
        name: "New Web Tunnel",
        localPort: 8081,
      });

      const updated = usePreferencesStore.getState().sshTunnels[0];
      expect(updated.name).toBe("New Web Tunnel");
      expect(updated.localPort).toBe(8081);
    });

    it("deletes a tunnel rule and stops it if active", async () => {
      const created = await addSshTunnel({
        name: "To Delete",
        tunnelType: "local",
        localPort: 9000,
        host: "web.server.com",
      });

      useLiveTunnelStore.getState().setTunnelStatus({
        id: created.id,
        status: "active",
      });
      expect(useLiveTunnelStore.getState().activeTunnels[created.id]?.status).toBe("active");

      await deleteSshTunnel(created.id);
      expect(usePreferencesStore.getState().sshTunnels).toHaveLength(0);
      expect(useLiveTunnelStore.getState().activeTunnels[created.id]).toBeUndefined();
    });

    it("tracks live active and connecting status in useLiveTunnelStore", () => {
      const store = useLiveTunnelStore.getState();

      store.setTunnelStatus({
        id: "tun-test-1",
        status: "connecting",
        startedAt: 12345,
      });
      expect(useLiveTunnelStore.getState().activeTunnels["tun-test-1"]?.status).toBe("connecting");

      store.setTunnelStatus({
        id: "tun-test-1",
        status: "active",
        startedAt: 12345,
      });
      expect(useLiveTunnelStore.getState().activeTunnels["tun-test-1"]?.status).toBe("active");

      store.setTunnelStatus({
        id: "tun-test-1",
        status: "stopped",
      });
      expect(useLiveTunnelStore.getState().activeTunnels["tun-test-1"]).toBeUndefined();
    });
  });

  describe("sanitizeSshTunnels", () => {
    it("sanitizes valid and invalid tunnel configs for export/import", () => {
      const raw = [
        {
          id: "t-1",
          name: "Clean Tunnel",
          tunnelType: "local",
          localPort: 3000,
          remotePort: 80,
          host: "server.com",
        },
        {
          // Invalid: no host and no connectionId
          id: "t-invalid",
          name: "Broken",
          host: "",
        },
      ];

      const sanitized = sanitizeSshTunnels(raw);
      expect(sanitized).toHaveLength(1);
      expect(sanitized[0].name).toBe("Clean Tunnel");
      expect(sanitized[0].localHost).toBe("127.0.0.1");
    });
  });
});
