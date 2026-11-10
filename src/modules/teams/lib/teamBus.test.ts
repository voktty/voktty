import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@/modules/harness/lib/fs";
import {
  getHarnessSessionSnapshot,
} from "@/modules/harness/lib/harnessControlBridge";
import {
  deliverPendingMessages,
  readBus,
  resetRateLimits,
  sendMessage,
} from "./teamBus";

vi.mock("@/modules/harness/lib/fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("@/modules/harness/lib/harnessControlBridge", () => ({
  getHarnessSessionSnapshot: vi.fn(),
  sendHarnessSessionMessage: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe("teamBus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
  });

  it("calculates hop count starting from 0 and increments with reply_to", async () => {
    let busJson = JSON.stringify({ version: 1, updatedAt: "", messages: [] });
    vi.mocked(readTextFile).mockImplementation(async (path: string) => {
      if (path.endsWith("bus.json")) return busJson;
      if (path.endsWith("agents.json")) {
        return JSON.stringify({
          $schema: "urn:voktty:team-state:1",
          version: 1,
          updatedAt: "",
          agents: {
            developer: { sessionId: "s_dev", status: "idle" },
            orchestrator: { sessionId: "s_orch", status: "idle" },
          },
        });
      }
      return "";
    });

    vi.mocked(writeTextFile).mockImplementation(async (path: string, content: string) => {
      if (path.endsWith("bus.json")) {
        busJson = content;
      }
    });

    // 1. Root message
    const msg1 = await sendMessage({
      projectPath: "/project",
      from: "orchestrator",
      to: "developer",
      kind: "task",
      text: "Implement feature X",
    });

    expect(msg1.hop).toBe(0);
    expect(msg1.delivered).toBe(true);

    // 2. Reply message
    const msg2 = await sendMessage({
      projectPath: "/project",
      from: "developer",
      to: "orchestrator",
      kind: "verdict",
      text: "Feature X done",
      replyTo: msg1.id,
    });

    expect(msg2.hop).toBe(1);
    expect(msg2.delivered).toBe(true);
  });

  it("cuts message loops when hop count exceeds 5", async () => {
    let busJson = JSON.stringify({
      version: 1,
      updatedAt: "",
      messages: [
        { id: "m0", hop: 0 },
        { id: "m1", hop: 1 },
        { id: "m2", hop: 2 },
        { id: "m3", hop: 3 },
        { id: "m4", hop: 4 },
        { id: "m5", hop: 5 },
      ],
    });

    vi.mocked(readTextFile).mockImplementation(async (path: string) => {
      if (path.endsWith("bus.json")) return busJson;
      return JSON.stringify({ agents: {} });
    });

    await expect(
      sendMessage({
        projectPath: "/project",
        from: "orchestrator",
        to: "developer",
        kind: "task",
        text: "Infinite loop task",
        replyTo: "m5",
      }),
    ).rejects.toThrow(/hop_limit_exceeded/);
  });

  it("enforces rate limit of 30 messages per minute", async () => {
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({ version: 1, updatedAt: "", messages: [], agents: {} }),
    );

    // Send 30 messages successfully
    for (let i = 0; i < 30; i++) {
      await sendMessage({
        projectPath: "/project",
        from: "spammy-agent",
        to: "other",
        kind: "status",
        text: `Ping ${i}`,
      });
    }

    // 31st message should be rejected
    await expect(
      sendMessage({
        projectPath: "/project",
        from: "spammy-agent",
        to: "other",
        kind: "status",
        text: "Ping 31",
      }),
    ).rejects.toThrow(/rate_limited/);
  });

  it("enforces maximum message size of 16 KiB", async () => {
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({ version: 1, updatedAt: "", messages: [], agents: {} }),
    );

    const oversizedText = "x".repeat(16 * 1024 + 1);

    await expect(
      sendMessage({
        projectPath: "/project",
        from: "orchestrator",
        to: "developer",
        kind: "task",
        text: oversizedText,
      }),
    ).rejects.toThrow(/message_too_large/);
  });

  it("enqueues message when recipient is working and delivers upon finish", async () => {
    let busJson = JSON.stringify({ version: 1, updatedAt: "", messages: [] });
    vi.mocked(readTextFile).mockImplementation(async (path: string) => {
      if (path.endsWith("bus.json")) return busJson;
      if (path.endsWith("agents.json")) {
        return JSON.stringify({
          $schema: "urn:voktty:team-state:1",
          version: 1,
          updatedAt: "",
          agents: {
            orchestrator: { sessionId: "s_orch", status: "working" },
          },
        });
      }
      return "";
    });

    vi.mocked(writeTextFile).mockImplementation(async (path: string, content: string) => {
      if (path.endsWith("bus.json")) busJson = content;
    });

    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "working",
    } as any);

    // Send verdict to working orchestrator
    const msg = await sendMessage({
      projectPath: "/project",
      from: "developer",
      to: "orchestrator",
      kind: "verdict",
      text: "Task finished successfully",
    });

    expect(msg.delivered).toBe(false);

    // Now orchestrator finishes its turn
    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "idle",
    } as any);

    const deliveredCount = await deliverPendingMessages("/project", "orchestrator");
    expect(deliveredCount).toBe(1);

    const updatedBus = await readBus("/project");
    expect(updatedBus.messages[0].delivered).toBe(true);
  });
});
