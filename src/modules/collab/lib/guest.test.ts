import {
  connectToHostedTerminal,
  decodeGuestTerminalEvent,
} from "@/modules/collab/lib/guest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));

describe("guest terminal bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      connectionId: 12,
      participant: { id: "guest-1", name: "Ada", role: "observer" },
      cols: 100,
      rows: 30,
      capabilities: { fileCitations: false },
    });
  });

  it("normalizes credentials and opens the four bounded channels", async () => {
    await connectToHostedTerminal(
      {
        connectionUrl: "  wss://host/v1/session/session-1  ",
        sessionId: " session-1 ",
        inviteCode: " code-1 ",
        participantName: " Ada ",
      },
      { onData: vi.fn() },
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "collab_guest_connect",
      expect.objectContaining({
        connectionUrl: "wss://host/v1/session/session-1",
        sessionId: "session-1",
        inviteCode: "code-1",
        participantName: "Ada",
        onData: expect.anything(),
        onControl: expect.anything(),
        onExit: expect.anything(),
        onStatus: expect.anything(),
      }),
    );
  });

  it("decodes ordered output, snapshot, and resize events", () => {
    expect(
      decodeGuestTerminalEvent(new Uint8Array([1, 65, 66]).buffer),
    ).toMatchObject({ type: "output", data: new Uint8Array([65, 66]) });
    expect(
      decodeGuestTerminalEvent(
        new Uint8Array([2, 0, 120, 0, 40, 27, 99, 65]).buffer,
      ),
    ).toMatchObject({
      type: "snapshot",
      cols: 120,
      rows: 40,
      data: new Uint8Array([27, 99, 65]),
    });
    expect(
      decodeGuestTerminalEvent(new Uint8Array([3, 0, 132, 0, 46]).buffer),
    ).toEqual({ type: "resize", cols: 132, rows: 46 });
  });

  it("writes through raw IPC and keeps resize local", async () => {
    const session = await connectToHostedTerminal(
      {
        connectionUrl: "wss://host/v1/session/session-1",
        sessionId: "session-1",
        inviteCode: "code-1",
        participantName: "Ada",
      },
      { onData: vi.fn() },
    );
    invokeMock.mockClear();

    await session.write("whoami\r");
    await session.resize(60, 20);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("collab_guest_write");
    expect(invokeMock.mock.calls[0]?.[2]).toEqual({
      headers: { "x-collab-id": "12" },
    });
  });

  it("requests and releases control explicitly", async () => {
    const session = await connectToHostedTerminal(
      {
        connectionUrl: "wss://host/v1/session/session-1",
        sessionId: "session-1",
        inviteCode: "code-1",
        participantName: "Ada",
      },
      { onData: vi.fn() },
    );
    invokeMock.mockClear();

    await session.requestControl();
    await session.releaseControl();

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "collab_guest_request_control",
      { connectionId: 12 },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "collab_guest_release_control",
      { connectionId: 12 },
    );
  });

  it("queues correlated file search and read controls", async () => {
    const session = await connectToHostedTerminal(
      {
        connectionUrl: "wss://host/v1/session/session-1",
        sessionId: "session-1",
        inviteCode: "code-1",
        participantName: "Ada",
      },
      { onData: vi.fn() },
    );
    invokeMock.mockClear();

    await session.fileSearch("search-1", "readme", 30);
    await session.fileRead("read-1", "README.md");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "collab_guest_file_search", {
      connectionId: 12,
      requestId: "search-1",
      query: "readme",
      limit: 30,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "collab_guest_file_read", {
      connectionId: 12,
      requestId: "read-1",
      path: "README.md",
    });
  });
});
