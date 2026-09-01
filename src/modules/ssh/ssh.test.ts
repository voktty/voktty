import { describe, expect, it } from "vitest";
import { parseSshConfig } from "./sshConfigParser";
import { buildSshCommand, formatSshSubtitle, type SshConnection } from "./types";

describe("SSH Module", () => {
  describe("buildSshCommand", () => {
    it("builds simple host command", () => {
      const conn: SshConnection = {
        id: "1",
        name: "Simple",
        host: "192.168.1.10",
      };
      expect(buildSshCommand(conn)).toBe("ssh 192.168.1.10");
    });

    it("builds user@host command with standard port", () => {
      const conn: SshConnection = {
        id: "1",
        name: "User Host",
        host: "myserver.com",
        user: "root",
        port: 22,
      };
      expect(buildSshCommand(conn)).toBe("ssh root@myserver.com");
    });

    it("builds custom port and identity file command", () => {
      const conn: SshConnection = {
        id: "1",
        name: "Custom",
        host: "vps.net",
        user: "ubuntu",
        port: 2222,
        identityFile: "C:/keys/vps.pem",
      };
      expect(buildSshCommand(conn)).toBe(
        'ssh -p 2222 -i "C:/keys/vps.pem" ubuntu@vps.net',
      );
    });

    it("includes extra arguments when provided", () => {
      const conn: SshConnection = {
        id: "1",
        name: "Extra",
        host: "server.local",
        extraArgs: "-X -C",
      };
      expect(buildSshCommand(conn)).toBe("ssh -X -C server.local");
    });
  });

  describe("formatSshSubtitle", () => {
    it("formats subtitles nicely", () => {
      expect(
        formatSshSubtitle({ id: "1", name: "S1", host: "10.0.0.1" }),
      ).toBe("10.0.0.1");
      expect(
        formatSshSubtitle({
          id: "2",
          name: "S2",
          host: "10.0.0.1",
          user: "admin",
        }),
      ).toBe("admin@10.0.0.1");
      expect(
        formatSshSubtitle({
          id: "3",
          name: "S3",
          host: "10.0.0.1",
          user: "admin",
          port: 2222,
        }),
      ).toBe("admin@10.0.0.1:2222");
    });
  });

  describe("parseSshConfig", () => {
    it("parses multiple ssh hosts correctly", () => {
      const sample = `
# Global config
Host *
    ServerAliveInterval 60

Host prod-server
    HostName 192.168.1.100
    User root
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host staging
    HostName staging.domain.com
    User deploy
`;
      const result = parseSshConfig(sample);
      expect(result).toHaveLength(2);

      expect(result[0].name).toBe("prod-server");
      expect(result[0].host).toBe("192.168.1.100");
      expect(result[0].user).toBe("root");
      expect(result[0].port).toBe(2222);
      expect(result[0].identityFile).toBe("~/.ssh/id_ed25519");

      expect(result[1].name).toBe("staging");
      expect(result[1].host).toBe("staging.domain.com");
      expect(result[1].user).toBe("deploy");
    });

    it("parses extra options and directives like HostKeyAlias, StrictHostKeyChecking, etc.", () => {
      const sample = `
Host forgenex-code4
    HostName 192.168.1.4
    User abc
    Port 9194
    HostKeyAlias forgenex-code4
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR
`;
      const result = parseSshConfig(sample);
      expect(result).toHaveLength(1);
      const conn = result[0];
      expect(conn.name).toBe("forgenex-code4");
      expect(conn.host).toBe("192.168.1.4");
      expect(conn.user).toBe("abc");
      expect(conn.port).toBe(9194);
      expect(conn.identityFile).toBe("~/.ssh/id_ed25519");
      expect(conn.extraArgs).toBe(
        "-o HostKeyAlias=forgenex-code4 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR",
      );
    });
  });

  describe("SshPing & Metrics types", () => {
    it("handles ping error fallback correctly", async () => {
      const { pingSshHost } = await import("./types");
      const res = await pingSshHost("127.0.0.1", 22);
      expect(res.host).toBe("127.0.0.1");
      expect(res.port).toBe(22);
      expect(typeof res.online).toBe("boolean");
    });

    it("exports useSshPing hook", async () => {
      const { useSshPing } = await import("./useSshPing");
      expect(typeof useSshPing).toBe("function");
    });
  });

  describe("Multiplexer session probe & configuration", () => {
    it("supports multiplexerMode and tmuxSessionName in SshConnection", () => {
      const conn: SshConnection = {
        id: "mux-1",
        name: "Mux Server",
        host: "10.0.0.5",
        multiplexerMode: "auto",
        tmuxSessionName: "dev-session",
        activeMultiplexerSession: "dev-session",
        multiplexerAction: "attach_force",
      };

      expect(conn.multiplexerMode).toBe("auto");
      expect(conn.tmuxSessionName).toBe("dev-session");
      expect(conn.activeMultiplexerSession).toBe("dev-session");
      expect(conn.multiplexerAction).toBe("attach_force");
    });
  });
});

