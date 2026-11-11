import { describe, expect, it, vi } from "vitest";
import {
  assertSafeAgentName,
  generateMailboxFileName,
  MAX_MAILBOX_FILE_BYTES,
  MAX_MAILBOX_READ_FILES,
  readRemoteInboxMessages,
  remoteInboxDir,
  remoteMailboxDir,
  writeRemoteMailboxMessage,
} from "./remoteMailbox";

describe("remoteMailbox", () => {
  describe("path validation and construction", () => {
    it("constructs mailbox directories correctly without outbox (S2)", () => {
      const remoteCwd = "remote://voktty-ssh-conn/srv/project";
      expect(remoteMailboxDir(remoteCwd, "worker")).toBe(
        "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker",
      );
      expect(remoteInboxDir(remoteCwd, "worker")).toBe(
        "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker/inbox",
      );
    });

    it("rejects invalid agent names or path traversal attempts", () => {
      expect(() => assertSafeAgentName("")).toThrow();
      expect(() => assertSafeAgentName("../escape")).toThrow("Invalid agent name");
      expect(() => assertSafeAgentName("worker/child")).toThrow("Invalid agent name");
      expect(() => assertSafeAgentName("worker\\child")).toThrow("Invalid agent name");
      expect(() => assertSafeAgentName("worker\0null")).toThrow("Invalid agent name");
    });
  });

  describe("writeRemoteMailboxMessage (S2 & kit format)", () => {
    it("generates filename matching kit pattern <UTC>-<sender>-<suffix>.json", () => {
      const date = new Date("2026-11-11T14:30:00.000Z");
      const filename = generateMailboxFileName("orchestrator", date);
      expect(filename).toMatch(/^2026-11-11T14-30-00-000Z-orchestrator-[a-z0-9]+\.json$/);
    });

    it("writes inbox message with exact MESSAGING.md fields and never leaks agent token", async () => {
      const writtenFiles = new Map<string, string>();
      const mockWrite = vi.fn(async (path: string, content: string) => {
        writtenFiles.set(path, content);
      });

      const message = {
        from: "orchestrator",
        to: "worker",
        kind: "task" as const,
        text: "Run test suite",
        sentAt: "2026-11-11T12:00:00.000Z",
        // Injected dirty secrets that must never reach disk
        token: "SUPER_SECRET_TOKEN",
        agentToken: "AGENT_BEARER_TOKEN",
        hop: 1,
        id: "msg_internal_id",
      };

      const path = await writeRemoteMailboxMessage(
        "remote://voktty-ssh-conn/srv/project",
        "worker",
        message,
        { writeTextFile: mockWrite },
      );

      expect(path).toContain(".voktty/mailbox/worker/inbox/");
      expect(path).toMatch(/2026-11-11T12-00-00-000Z-orchestrator-[a-z0-9]+\.json$/);

      const content = writtenFiles.get(path)!;
      expect(content).toBeDefined();
      const parsed = JSON.parse(content);

      // Exactly the fields from MESSAGING.md
      expect(parsed).toEqual({
        from: "orchestrator",
        to: "worker",
        kind: "task",
        text: "Run test suite",
        sentAt: "2026-11-11T12:00:00.000Z",
      });

      // S2: No id, no hop, no outbox
      expect(parsed.id).toBeUndefined();
      expect(parsed.hop).toBeUndefined();

      // Security invariant: token must never appear in remote inbox file
      expect(content).not.toContain("SUPER_SECRET_TOKEN");
      expect(content).not.toContain("AGENT_BEARER_TOKEN");
      expect(content).not.toContain('"token"');
      expect(content).not.toContain('"agentToken"');
    });
  });

  describe("readRemoteInboxMessages (I1 limits)", () => {
    it("respects MAX_MAILBOX_READ_FILES limit (I1)", async () => {
      const mockEntries = Array.from({ length: 80 }, (_, i) => ({
        name: `msg_${String(i).padStart(3, "0")}.json`,
        path: `remote://conn/srv/.voktty/mailbox/worker/inbox/msg_${String(i).padStart(3, "0")}.json`,
        isDir: false,
        ignored: false,
      }));

      const files = new Map<string, string>();
      for (const entry of mockEntries) {
        files.set(
          entry.path,
          JSON.stringify({
            from: "peer",
            to: "worker",
            kind: "task",
            text: `Task ${entry.name}`,
            sentAt: "2026-11-11T10:00:00.000Z",
          }),
        );
      }

      const mockListDir = vi.fn(async () => mockEntries);
      const mockReadTextFile = vi.fn(async (path: string) => files.get(path) || "");

      const messages = await readRemoteInboxMessages("remote://conn/srv", "worker", {
        listDir: mockListDir,
        readTextFile: mockReadTextFile,
      });

      // Clamped to MAX_MAILBOX_READ_FILES (50)
      expect(messages.length).toBe(MAX_MAILBOX_READ_FILES);
      expect(mockReadTextFile).toHaveBeenCalledTimes(MAX_MAILBOX_READ_FILES);
    });

    it("skips files exceeding MAX_MAILBOX_FILE_BYTES (I1)", async () => {
      const normalEntry = {
        name: "normal.json",
        path: "remote://conn/srv/.voktty/mailbox/worker/inbox/normal.json",
        isDir: false,
        ignored: false,
      };
      const oversizedEntry = {
        name: "huge.json",
        path: "remote://conn/srv/.voktty/mailbox/worker/inbox/huge.json",
        isDir: false,
        ignored: false,
      };

      const oversizedContent = "x".repeat(MAX_MAILBOX_FILE_BYTES + 1024);
      const normalContent = JSON.stringify({
        from: "peer",
        to: "worker",
        kind: "status",
        text: "normal payload",
        sentAt: "2026-11-11T11:00:00.000Z",
      });

      const files = new Map([
        [normalEntry.path, normalContent],
        [oversizedEntry.path, oversizedContent],
      ]);

      const mockListDir = vi.fn(async () => [oversizedEntry, normalEntry]);
      const mockReadTextFile = vi.fn(async (path: string) => files.get(path) || "");

      const messages = await readRemoteInboxMessages("remote://conn/srv", "worker", {
        listDir: mockListDir,
        readTextFile: mockReadTextFile,
      });

      expect(messages.length).toBe(1);
      expect(messages[0].text).toBe("normal payload");
    });
  });

  describe("transport resilience (SSH disconnect & retry)", () => {
    it("handles temporary network drop and succeeds upon reconnect", async () => {
      const writtenFiles = new Map<string, string>();
      let attempts = 0;

      const flakyWriter = vi.fn(async (path: string, content: string) => {
        attempts++;
        if (attempts === 1) {
          throw new Error("SSH transport error: Connection reset by peer");
        }
        writtenFiles.set(path, content);
      });

      const message = {
        from: "orchestrator",
        to: "worker",
        kind: "decision" as const,
        text: "Retry deployment",
        sentAt: "2026-11-11T12:00:00.000Z",
      };

      // 1. Initial attempt fails due to network drop
      await expect(
        writeRemoteMailboxMessage(
          "remote://voktty-ssh-conn/srv/project",
          "worker",
          message,
          { writeTextFile: flakyWriter },
        ),
      ).rejects.toThrow("Connection reset by peer");

      // 2. Reconnect & retry succeeds cleanly
      const path = await writeRemoteMailboxMessage(
        "remote://voktty-ssh-conn/srv/project",
        "worker",
        message,
        { writeTextFile: flakyWriter },
      );

      expect(writtenFiles.has(path)).toBe(true);
      expect(writtenFiles.get(path)).toContain("Retry deployment");
    });
  });
});
