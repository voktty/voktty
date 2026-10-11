import { describe, expect, it } from "vitest";
import {
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
