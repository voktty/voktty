import { createHostedShare } from "@/modules/collab/lib/sharing";
import { describe, expect, it, vi } from "vitest";

describe("createHostedShare", () => {
  it("synchronizes the terminal snapshot before publishing its tunnel", async () => {
    const calls: string[] = [];
    const start = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      inviteCode: "code-1",
      loopbackUrl: "ws://127.0.0.1:4300/v1/session/session-1",
      expiresAtMs: 123,
    });
    const publish = vi.fn().mockResolvedValue({
      publicUrl: "https://quiet-river.trycloudflare.com",
      connectionUrl: "wss://quiet-river.trycloudflare.com/v1/session/session-1",
    });
    start.mockImplementation(async () => {
      calls.push("start");
      return {
        sessionId: "session-1",
        inviteCode: "code-1",
        loopbackUrl: "ws://127.0.0.1:4300/v1/session/session-1",
        expiresAtMs: 123,
      };
    });
    const snapshot = vi.fn().mockImplementation(async () => {
      calls.push("snapshot");
    });
    publish.mockImplementation(async () => {
      calls.push("publish");
      return {
        publicUrl: "https://quiet-river.trycloudflare.com",
        connectionUrl:
          "wss://quiet-river.trycloudflare.com/v1/session/session-1",
      };
    });

    const result = await createHostedShare(
      { leafId: 18, ptyId: 8, cols: 100, rows: 30 },
      { start, snapshot, publish, stop: vi.fn() },
    );

    expect(start).toHaveBeenCalledWith(8, 100, 30);
    expect(snapshot).toHaveBeenCalledWith(18, 8);
    expect(publish).toHaveBeenCalledWith(8, undefined);
    expect(calls).toEqual(["start", "snapshot", "publish"]);
    expect(result.invite.sessionId).toBe("session-1");
    expect(result.tunnel.connectionUrl).toContain("session-1");
  });

  it("stops the local host if cloudflared cannot publish it", async () => {
    const stop = vi.fn().mockResolvedValue(true);
    const publishError = new Error("tunnel failed");

    await expect(
      createHostedShare(
        { leafId: 18, ptyId: 8, cols: 80, rows: 24 },
        {
          start: vi.fn().mockResolvedValue({
            sessionId: "session-1",
            inviteCode: "code-1",
            loopbackUrl: "ws://127.0.0.1:4300/v1/session/session-1",
            expiresAtMs: 123,
          }),
          snapshot: vi.fn().mockResolvedValue(undefined),
          publish: vi.fn().mockRejectedValue(publishError),
          stop,
        },
      ),
    ).rejects.toBe(publishError);

    expect(stop).toHaveBeenCalledWith(8);
  });

  it("stops the local host if the initial snapshot cannot be synchronized", async () => {
    const stop = vi.fn().mockResolvedValue(true);
    const snapshotError = new Error("snapshot failed");

    await expect(
      createHostedShare(
        { leafId: 18, ptyId: 8, cols: 80, rows: 24 },
        {
          start: vi.fn().mockResolvedValue({
            sessionId: "session-1",
            inviteCode: "code-1",
            loopbackUrl: "ws://127.0.0.1:4300/v1/session/session-1",
            expiresAtMs: 123,
          }),
          snapshot: vi.fn().mockRejectedValue(snapshotError),
          publish: vi.fn(),
          stop,
        },
      ),
    ).rejects.toBe(snapshotError);

    expect(stop).toHaveBeenCalledWith(8);
  });

  it("passes the explicitly enabled citation root to the host", async () => {
    const start = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      inviteCode: "code-1",
      loopbackUrl: "ws://127.0.0.1:4300/v1/session/session-1",
      expiresAtMs: 123,
    });

    await createHostedShare(
      {
        leafId: 18,
        ptyId: 8,
        cols: 80,
        rows: 24,
        fileCitationRoot: "C:/project",
      },
      {
        start,
        snapshot: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue({
          publicUrl: "https://example.trycloudflare.com",
          connectionUrl: "wss://example.trycloudflare.com/v1/session/session-1",
        }),
        stop: vi.fn(),
      },
    );

    expect(start).toHaveBeenCalledWith(8, 80, 24, "C:/project");
  });
});
