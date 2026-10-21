import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportRemoteSessionProblem,
  resetRemoteSessionProblems,
  subscribeRemoteSessionProblems,
} from "./remoteSessionAlerts";

describe("remote session problems", () => {
  beforeEach(resetRemoteSessionProblems);

  it("reports a failed save with the reason", () => {
    const listener = vi.fn();
    const stop = subscribeRemoteSessionProblems(listener);
    reportRemoteSessionProblem(
      "save-failed",
      "remote://voktty-ssh-a/srv/app",
      new Error("write_failed: permission denied"),
    );
    expect(listener).toHaveBeenCalledWith({
      kind: "save-failed",
      cwd: "remote://voktty-ssh-a/srv/app",
      message: "write_failed: permission denied",
    });
    stop();
  });

  it("repeats a problem for the same project only after a few minutes", () => {
    const listener = vi.fn();
    const stop = subscribeRemoteSessionProblems(listener);
    const cwd = "remote://voktty-ssh-a/srv/app";
    expect(reportRemoteSessionProblem("save-failed", cwd, "x", 0)).toBe(true);
    expect(reportRemoteSessionProblem("save-failed", cwd, "x", 1000)).toBe(
      false,
    );
    expect(
      reportRemoteSessionProblem("save-failed", cwd, "x", 5 * 60_000 + 1),
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps different causes and projects independent", () => {
    const listener = vi.fn();
    const stop = subscribeRemoteSessionProblems(listener);
    reportRemoteSessionProblem("save-failed", "remote://a/x", "e", 0);
    reportRemoteSessionProblem("no-saved-project", "remote://a/x", undefined, 0);
    reportRemoteSessionProblem("save-failed", "remote://a/y", "e", 0);
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
  });
});
