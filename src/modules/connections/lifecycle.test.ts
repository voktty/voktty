import { describe, expect, it } from "vitest";
import {
  beginConnectionAttempt,
  disconnectConnection,
  IDLE_CONNECTION_STATE,
  isConnectionPending,
  requestConnectionCancellation,
  settleConnectionAttempt,
} from "./lifecycle";

describe("resource connection lifecycle", () => {
  it("ignores a stale completion from an older attempt", () => {
    const first = beginConnectionAttempt(IDLE_CONNECTION_STATE, "connecting");
    const retry = beginConnectionAttempt(first, "reconnecting");

    expect(settleConnectionAttempt(retry, first.attempt, "ready")).toBe(retry);
    expect(settleConnectionAttempt(retry, retry.attempt, "ready")).toEqual({
      phase: "ready",
      attempt: 2,
      error: null,
    });
  });

  it("keeps cancellation observable until the active attempt settles", () => {
    const connecting = beginConnectionAttempt(
      IDLE_CONNECTION_STATE,
      "connecting",
    );
    const cancelling = requestConnectionCancellation(connecting);

    expect(cancelling.phase).toBe("cancelling");
    expect(isConnectionPending(cancelling)).toBe(true);
    expect(
      settleConnectionAttempt(cancelling, cancelling.attempt, "disconnected"),
    ).toEqual({ phase: "disconnected", attempt: 1, error: null });
  });

  it("preserves a useful disconnect reason", () => {
    const ready = settleConnectionAttempt(
      beginConnectionAttempt(IDLE_CONNECTION_STATE, "connecting"),
      1,
      "ready",
    );

    expect(disconnectConnection(ready, "process exited with code 127")).toEqual(
      {
        phase: "disconnected",
        attempt: 1,
        error: "process exited with code 127",
      },
    );
  });
});
