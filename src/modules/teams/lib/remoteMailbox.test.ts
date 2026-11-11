import { describe, expect, it, vi } from "vitest";
import type { TeamBusMessage } from "../types";
import {
  assertSafeAgentName,
  readLatestRemoteMailboxVerdict,
  readRemoteMailboxVerdicts,
  remoteInboxDir,
  remoteMailboxDir,
  remoteOutboxDir,
  writeRemoteMailboxMessage,
} from "./remoteMailbox";

describe("remoteMailbox", () => {
  describe("path validation and construction", () => {
    it("constructs mailbox directories correctly", () => {
      const remoteCwd = "remote://voktty-ssh-conn/srv/project";
      expect(remoteMailboxDir(remoteCwd, "worker")).toBe(
        "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker",
      );
      expect(remoteInboxDir(remoteCwd, "worker")).toBe(
        "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker/inbox",
      );
      expect(remoteOutboxDir(remoteCwd, "worker")).toBe(
        "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker/outbox",
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

  describe("writeRemoteMailboxMessage", () => {
    it("writes inbox message file and never leaks agent token", async () => {
      const writtenFiles = new Map<string, string>();
      const mockWrite = vi.fn(async (path: string, content: string) => {
        writtenFiles.set(path, content);
      });

      const message: TeamBusMessage & { token?: string; agentToken?: string } = {
        id: "msg_12345",
        projectPath: "remote://voktty-ssh-conn/srv/project",
        from: "orchestrator",
        to: "worker",
        kind: "task",
        text: "Run test suite",
        timestamp: "2026-11-11T12:00:00.000Z",
        hop: 0,
        delivered: true,
        read: false,
        // Injected dirty secrets that must never reach disk
        token: "SUPER_SECRET_TOKEN",
        agentToken: "AGENT_BEARER_TOKEN",
      };

      const path = await writeRemoteMailboxMessage(
        "remote://voktty-ssh-conn/srv/project",
        "worker",
        message,
        { writeTextFile: mockWrite },
      );

      expect(path).toBe(
        "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker/inbox/msg_12345.json",
      );

      const content = writtenFiles.get(path)!;
      expect(content).toBeDefined();
      expect(content).toContain('"text": "Run test suite"');
      expect(content).toContain('"from": "orchestrator"');

      // Security invariant: token must never appear in remote inbox file
      expect(content).not.toContain("SUPER_SECRET_TOKEN");
      expect(content).not.toContain("AGENT_BEARER_TOKEN");
      expect(content).not.toContain('"token"');
      expect(content).not.toContain('"agentToken"');
    });
  });

  describe("readRemoteMailboxVerdicts", () => {
    it("reads and sorts verdicts from outbox newest first", async () => {
      const mockEntries = [
        {
          name: "old_verdict.json",
          path: "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker/outbox/old_verdict.json",
          isDir: false,
          ignored: false,
        },
        {
          name: "new_verdict.json",
          path: "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker/outbox/new_verdict.json",
          isDir: false,
          ignored: false,
        },
        {
          name: "ignored_folder",
          path: "remote://voktty-ssh-conn/srv/project/.voktty/mailbox/worker/outbox/ignored_folder",
          isDir: true,
          ignored: false,
        },
      ];

      const files = new Map<string, string>([
        [
          mockEntries[0].path,
          JSON.stringify({
            text: "Initial tests failed",
            timestamp: "2026-11-11T10:00:00.000Z",
            messageId: "msg_1",
          }),
        ],
        [
          mockEntries[1].path,
          JSON.stringify({
            text: "All tests green",
            timestamp: "2026-11-11T11:00:00.000Z",
            messageId: "msg_2",
          }),
        ],
      ]);

      const mockListDir = vi.fn(async () => mockEntries);
      const mockReadTextFile = vi.fn(async (path: string) => {
        const c = files.get(path);
        if (!c) throw new Error("File not found");
        return c;
      });

      const verdicts = await readRemoteMailboxVerdicts(
        "remote://voktty-ssh-conn/srv/project",
        "worker",
        { listDir: mockListDir, readTextFile: mockReadTextFile },
      );

      expect(verdicts).toHaveLength(2);
      expect(verdicts[0].text).toBe("All tests green");
      expect(verdicts[1].text).toBe("Initial tests failed");

      const latest = await readLatestRemoteMailboxVerdict(
        "remote://voktty-ssh-conn/srv/project",
        "worker",
        { listDir: mockListDir, readTextFile: mockReadTextFile },
      );
      expect(latest?.text).toBe("All tests green");
      expect(latest?.messageId).toBe("msg_2");
    });

    it("returns empty array if outbox directory does not exist yet", async () => {
      const mockListDir = vi.fn(async () => {
        throw new Error("Directory does not exist");
      });
      const verdicts = await readRemoteMailboxVerdicts(
        "remote://voktty-ssh-conn/srv/project",
        "worker",
        { listDir: mockListDir },
      );
      expect(verdicts).toEqual([]);
    });
  });

  describe("resilience against SSH drops and reconnect", () => {
    it("handles temporary transport disconnect and recovers upon reconnect", async () => {
      let isConnected = false;
      const written = new Map<string, string>();

      const flakeyWriter = async (path: string, content: string) => {
        if (!isConnected) {
          throw new Error("SSH connection lost: broken pipe");
        }
        written.set(path, content);
      };

      const message: TeamBusMessage = {
        id: "msg_resilience_1",
        projectPath: "remote://voktty-ssh-conn/srv/project",
        from: "orchestrator",
        to: "worker",
        kind: "task",
        text: "Resume build",
        timestamp: new Date().toISOString(),
        hop: 0,
        delivered: false,
        read: false,
      };

      // 1. Initial attempt fails while SSH is down
      await expect(
        writeRemoteMailboxMessage(
          "remote://voktty-ssh-conn/srv/project",
          "worker",
          message,
          { writeTextFile: flakeyWriter },
        ),
      ).rejects.toThrow("SSH connection lost");

      // 2. SSH reconnects (helper re-attaches)
      isConnected = true;

      // 3. Retry succeeds and writes cleanly
      const savedPath = await writeRemoteMailboxMessage(
        "remote://voktty-ssh-conn/srv/project",
        "worker",
        message,
        { writeTextFile: flakeyWriter },
      );

      expect(savedPath).toContain("msg_resilience_1.json");
      expect(written.get(savedPath)).toContain('"text": "Resume build"');
    });
  });
});
