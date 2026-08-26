import { describe, expect, it } from "vitest";
import {
  exportConfiguration,
  sanitizeSshConnections,
  stripSensitiveFields,
  validateAndParseConfig,
} from "./configExport";
import type { Preferences } from "./store";

describe("configExport", () => {
  describe("stripSensitiveFields", () => {
    it("removes common secret keys like password, apikey, token, privateKey", () => {
      const input = {
        theme: "dark",
        apiKey: "sk-123456",
        API_KEY: "secret-val",
        password: "my-password",
        secretToken: "xyz",
        nested: {
          token: "bearer-xxx",
          fontSize: 14,
          private_key: "PRIVATE KEY DATA",
        },
        list: [
          { name: "server1", passphrase: "abc" },
          { name: "server2", host: "1.2.3.4" },
        ],
      };

      const result = stripSensitiveFields(input);
      expect(result).toEqual({
        theme: "dark",
        nested: {
          fontSize: 14,
        },
        list: [
          { name: "server1" },
          { name: "server2", host: "1.2.3.4" },
        ],
      });
      expect(result).not.toHaveProperty("apiKey");
      expect(result).not.toHaveProperty("password");
      expect((result.nested as any)).not.toHaveProperty("token");
    });
  });

  describe("sanitizeSshConnections", () => {
    it("sanitizes SSH connection array properly", () => {
      const raw = [
        {
          id: "ssh-1",
          name: "Prod Server",
          host: "192.168.1.100",
          port: 2222,
          user: "admin",
          identityFile: "~/.ssh/id_ed25519",
          extraArgs: "-v",
          initialDirectory: "/var/www",
          password: "should-not-be-here",
        },
        {
          name: "Invalid No Host",
        },
      ];

      const sanitized = sanitizeSshConnections(raw);
      expect(sanitized).toHaveLength(1);
      expect(sanitized[0]).toEqual({
        id: "ssh-1",
        name: "Prod Server",
        host: "192.168.1.100",
        port: 2222,
        user: "admin",
        identityFile: "~/.ssh/id_ed25519",
        extraArgs: "-v",
        initialDirectory: "/var/www",
      });
      expect((sanitized[0] as any).password).toBeUndefined();
    });
  });

  describe("exportConfiguration", () => {
    it("exports clean config object with version and app", () => {
      const mockPrefs: Partial<Preferences> = {
        theme: "dark",
        editorFontSize: 16,
        terminalFontSize: 15,
        sshConnections: [
          {
            id: "ssh-1",
            name: "Server",
            host: "example.com",
            port: 22,
          },
        ],
      };

      const exported = exportConfiguration(mockPrefs);
      expect(exported.app).toBe("voktty");
      expect(exported.version).toBe(1);
      expect(exported.preferences.theme).toBe("dark");
      expect(exported.preferences.editorFontSize).toBe(16);
      expect(exported.preferences.terminalFontSize).toBe(15);
      expect(exported.sshConnections).toHaveLength(1);
      expect(exported.sshConnections![0].host).toBe("example.com");
    });
  });

  describe("validateAndParseConfig", () => {
    it("parses valid Voktty config format", () => {
      const json = JSON.stringify({
        version: 1,
        app: "voktty",
        exportedAt: "2026-08-22T00:00:00Z",
        preferences: {
          terminalFontSize: 18,
          theme: "light",
        },
        sshConnections: [
          {
            id: "ssh-123",
            name: "Dev",
            host: "10.0.0.1",
          },
        ],
      });

      const parsed = validateAndParseConfig(json);
      expect(parsed.valid).toBe(true);
      expect(parsed.preferences?.terminalFontSize).toBe(18);
      expect(parsed.preferences?.theme).toBe("light");
      expect(parsed.sshConnections).toHaveLength(1);
    });

    it("parses direct flat preferences JSON", () => {
      const json = JSON.stringify({
        terminalFontSize: 14,
        editorFontSize: 13,
        sshConnections: [
          {
            id: "ssh-2",
            name: "Direct Host",
            host: "direct.local",
          },
        ],
      });

      const parsed = validateAndParseConfig(json);
      expect(parsed.valid).toBe(true);
      expect(parsed.preferences?.terminalFontSize).toBe(14);
      expect(parsed.sshConnections).toHaveLength(1);
    });

    it("returns error for invalid JSON", () => {
      const parsed = validateAndParseConfig("{ invalid json ");
      expect(parsed.valid).toBe(false);
      expect(parsed.error).toBeDefined();
    });
  });
});
