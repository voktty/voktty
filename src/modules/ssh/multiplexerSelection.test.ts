import { describe, expect, it } from "vitest";
import {
  automaticMultiplexerSessionName,
  shouldPickSshMultiplexer,
  sshMultiplexerSettingsForSelection,
} from "./multiplexerSelection";
import type { RemoteMultiplexerProbe } from "./types";

const emptyProbe: RemoteMultiplexerProbe = {
  supported: true,
  sessions: [],
};
const session = (name: string, isAttached: boolean, attachedCount: number) => ({
  name,
  windowsCount: 1,
  attachedCount,
  isAttached,
  multiplexer: "tmux",
});

describe("SSH multiplexer selection", () => {
  it("prompts for ask mode even when no session exists yet", () => {
    expect(
      shouldPickSshMultiplexer(
        { host: "server", multiplexerMode: "ask" },
        emptyProbe,
      ),
    ).toBe(true);
  });

  it("prompts when there are multiple or attached sessions", () => {
    expect(
      shouldPickSshMultiplexer(
        { host: "server", multiplexerMode: "auto" },
        {
          supported: true,
          sessions: [session("one", false, 0), session("two", false, 0)],
        },
      ),
    ).toBe(true);
    expect(
      shouldPickSshMultiplexer(
        { host: "server" },
        { supported: true, sessions: [session("one", false, 1)] },
      ),
    ).toBe(true);
  });

  it("skips unsupported probes and profiles with multiplexing disabled", () => {
    expect(
      shouldPickSshMultiplexer(
        { host: "server", multiplexerMode: "auto" },
        { supported: false, sessions: [] },
      ),
    ).toBe(false);
    expect(
      shouldPickSshMultiplexer(
        { host: "server", multiplexerMode: "none" },
        { supported: true, sessions: [session("one", true, 1)] },
      ),
    ).toBe(false);
  });

  it("prompts for a single detached session the automatic path would skip", () => {
    expect(
      shouldPickSshMultiplexer(
        { host: "server", multiplexerMode: "auto" },
        { supported: true, sessions: [session("agent-build", false, 0)] },
      ),
    ).toBe(true);
  });

  it("joins the automatic session silently when it is the only one", () => {
    expect(
      shouldPickSshMultiplexer(
        { host: "server", multiplexerMode: "auto" },
        { supported: true, sessions: [session("voktty", false, 0)] },
      ),
    ).toBe(false);
    expect(
      shouldPickSshMultiplexer(
        { host: "server", tmuxSessionName: "my work" },
        { supported: true, sessions: [session("my_work", false, 0)] },
      ),
    ).toBe(false);
  });

  it("connects without asking when the host has no sessions yet", () => {
    expect(
      shouldPickSshMultiplexer(
        { host: "server", multiplexerMode: "auto" },
        emptyProbe,
      ),
    ).toBe(false);
  });

  it("names the automatic session like the PTY command does", () => {
    expect(automaticMultiplexerSessionName({ host: "server" })).toBe("voktty");
    expect(
      automaticMultiplexerSessionName({
        host: "server",
        tmuxSessionName: "dev",
        activeMultiplexerSession: "build/1",
      }),
    ).toBe("build_1");
    expect(
      automaticMultiplexerSessionName({ host: "server", tmuxSessionName: "  " }),
    ).toBe("voktty");
  });

  it("converts a picker choice into the SSH PTY configuration", () => {
    expect(
      sshMultiplexerSettingsForSelection(
        { host: "server", multiplexerMode: "auto" },
        { action: "attach_force", sessionName: "build" },
      ),
    ).toEqual({
      multiplexerMode: "auto",
      activeMultiplexerSession: "build",
      multiplexerAction: "attach_force",
    });
    expect(
      sshMultiplexerSettingsForSelection(
        { host: "server", activeMultiplexerSession: "build" },
        { action: "none" },
      ),
    ).toEqual({
      multiplexerMode: "none",
      activeMultiplexerSession: undefined,
      multiplexerAction: undefined,
    });
  });
});
