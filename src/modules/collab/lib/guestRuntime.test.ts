import type { GuestTerminalHandlers } from "@/modules/collab/lib/guest";
import {
  forgetGuestTerminal,
  openCollabGuestPty,
  readGuestFile,
  registerGuestTerminal,
  requestGuestControl,
  searchGuestFiles,
  useCollabGuestStore,
} from "@/modules/collab/lib/guestRuntime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/collab/lib/guest", () => ({
  connectToHostedTerminal: connectMock,
}));

const credentials = {
  connectionUrl: "wss://example.com/v1/session/session-1",
  sessionId: "session-1",
  inviteCode: "code-1",
  participantName: "Ada",
};

describe("guest terminal runtime", () => {
  beforeEach(() => {
    connectMock.mockReset();
    forgetGuestTerminal(22);
    useCollabGuestStore.setState({ sessions: {} });
  });

  it("keeps credentials in memory and blocks observer input", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    connectMock.mockResolvedValue({
      welcome: {
        connectionId: 9,
        participant: { id: "guest-1", name: "Ada", role: "observer" },
        cols: 100,
        rows: 30,
        capabilities: { fileCitations: false },
      },
      write,
      resize: vi.fn(),
      requestControl: vi.fn(),
      releaseControl: vi.fn(),
      close: vi.fn(),
    });
    registerGuestTerminal(22, credentials);

    const pty = await openCollabGuestPty(22, {
      onData: vi.fn(),
      onExit: vi.fn(),
    });
    await pty.write("whoami\r");

    expect(write).not.toHaveBeenCalled();
    expect(useCollabGuestStore.getState().sessions[22]).toMatchObject({
      status: "connected",
      role: "observer",
      participantName: "Ada",
    });
  });

  it("updates the role from control messages and then forwards input", async () => {
    let handlers: GuestTerminalHandlers | undefined;
    const write = vi.fn().mockResolvedValue(undefined);
    const requestControl = vi.fn().mockResolvedValue(undefined);
    connectMock.mockImplementation(async (_credentials, nextHandlers) => {
      handlers = nextHandlers;
      return {
        welcome: {
          connectionId: 9,
          participant: { id: "guest-1", name: "Ada", role: "observer" },
          cols: 100,
          rows: 30,
          capabilities: { fileCitations: false },
        },
        write,
        resize: vi.fn(),
        requestControl,
        releaseControl: vi.fn(),
        close: vi.fn(),
      };
    });
    registerGuestTerminal(22, credentials);
    const pty = await openCollabGuestPty(22, { onData: vi.fn() });

    await requestGuestControl(22);
    handlers?.onControl?.({
      type: "role_changed",
      participantId: "guest-1",
      role: "controller",
    });
    await pty.write("whoami\r");

    expect(requestControl).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith("whoami\r");
    expect(useCollabGuestStore.getState().sessions[22]?.role).toBe(
      "controller",
    );
  });

  it("keeps the guest id outside the local PTY namespace while reconnecting", async () => {
    let handlers: GuestTerminalHandlers | undefined;
    const write = vi.fn();
    connectMock.mockImplementation(async (_credentials, nextHandlers) => {
      handlers = nextHandlers;
      return {
        welcome: {
          connectionId: 9,
          participant: { id: "guest-1", name: "Ada", role: "observer" },
          cols: 100,
          rows: 30,
          capabilities: { fileCitations: false },
        },
        write,
        resize: vi.fn(),
        requestControl: vi.fn(),
        releaseControl: vi.fn(),
        close: vi.fn(),
      };
    });
    registerGuestTerminal(22, credentials);

    const pty = await openCollabGuestPty(22, { onData: vi.fn() });
    handlers?.onStatus?.("reconnecting");
    await pty.write("blocked\r");
    handlers?.onControl?.({
      type: "joined",
      participant: {
        id: "guest-2",
        name: "Ada",
        role: "observer",
        controlRequested: false,
      },
      cols: 100,
      rows: 30,
      capabilities: { fileCitations: false },
    });
    handlers?.onControl?.({
      type: "role_changed",
      participantId: "guest-2",
      role: "controller",
    });
    await pty.write("allowed\r");

    expect(pty.id).toBe(-9);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith("allowed\r");
    expect(useCollabGuestStore.getState().sessions[22]).toMatchObject({
      status: "connected",
      participantId: "guest-2",
      role: "controller",
    });
  });

  it("correlates remote file search and read responses", async () => {
    let handlers: GuestTerminalHandlers | undefined;
    const fileSearch = vi.fn().mockResolvedValue(undefined);
    const fileRead = vi.fn().mockResolvedValue(undefined);
    connectMock.mockImplementation(async (_credentials, nextHandlers) => {
      handlers = nextHandlers;
      return {
        welcome: {
          connectionId: 9,
          participant: { id: "guest-1", name: "Ada", role: "observer" },
          cols: 100,
          rows: 30,
          capabilities: { fileCitations: true },
        },
        write: vi.fn(),
        resize: vi.fn(),
        requestControl: vi.fn(),
        releaseControl: vi.fn(),
        fileSearch,
        fileRead,
        close: vi.fn(),
      };
    });
    registerGuestTerminal(22, credentials);
    await openCollabGuestPty(22, { onData: vi.fn() });

    const search = searchGuestFiles(22, "readme");
    const searchId = fileSearch.mock.calls[0]?.[0] as string;
    handlers?.onControl?.({
      type: "file_search_result",
      requestId: searchId,
      files: [{ path: "README.md" }],
      truncated: false,
    });
    await expect(search).resolves.toEqual({
      files: ["README.md"],
      truncated: false,
    });

    const read = readGuestFile(22, "README.md");
    const readId = fileRead.mock.calls[0]?.[0] as string;
    handlers?.onControl?.({
      type: "file_content",
      requestId: readId,
      path: "README.md",
      content: "shared",
      truncated: false,
    });
    await expect(read).resolves.toEqual({
      path: "README.md",
      content: "shared",
      truncated: false,
    });
  });
});
