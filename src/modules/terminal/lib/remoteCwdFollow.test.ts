import { describe, expect, it } from "vitest";
import {
  REMOTE_CWD_SILENCE_MS,
  type RemoteCwdFollowInput,
  shouldFollowRemoteCwd,
} from "./remoteCwdFollow";

const base: RemoteCwdFollowInput = {
  ssh: true,
  hasPty: true,
  shellExited: false,
  visible: true,
  focused: true,
  agentActive: false,
  shellReportedCwd: true,
  openedForMs: 60_000,
  lookupInFlight: false,
};

const follow = (patch: Partial<RemoteCwdFollowInput>) =>
  shouldFollowRemoteCwd({ ...base, ...patch });

describe("shouldFollowRemoteCwd", () => {
  it("leaves a healthy idle shell to its own reports", () => {
    expect(follow({})).toBe(false);
  });

  it("asks the helper while an agent owns the terminal", () => {
    expect(follow({ agentActive: true })).toBe(true);
  });

  it("asks the helper when integration never reported a folder", () => {
    expect(
      follow({ shellReportedCwd: false, openedForMs: REMOTE_CWD_SILENCE_MS }),
    ).toBe(true);
  });

  it("gives a new terminal time to report before polling", () => {
    expect(
      follow({
        shellReportedCwd: false,
        openedForMs: REMOTE_CWD_SILENCE_MS - 1,
      }),
    ).toBe(false);
  });

  it("never polls local, closed, hidden, unfocused or already-queried terminals", () => {
    const agent = { agentActive: true };
    expect(follow({ ...agent, ssh: false })).toBe(false);
    expect(follow({ ...agent, hasPty: false })).toBe(false);
    expect(follow({ ...agent, shellExited: true })).toBe(false);
    expect(follow({ ...agent, visible: false })).toBe(false);
    expect(follow({ ...agent, focused: false })).toBe(false);
    expect(follow({ ...agent, lookupInFlight: true })).toBe(false);
  });
});
