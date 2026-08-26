export type ResourceConnectionPhase =
  | "idle"
  | "resolving"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "failed"
  | "disconnected"
  | "cancelling";

export type ResourceConnectionState = {
  phase: ResourceConnectionPhase;
  attempt: number;
  error: string | null;
};

export const IDLE_CONNECTION_STATE: ResourceConnectionState = {
  phase: "idle",
  attempt: 0,
  error: null,
};

export function beginConnectionAttempt(
  current: ResourceConnectionState,
  phase: "resolving" | "connecting" | "reconnecting",
): ResourceConnectionState {
  return {
    phase,
    attempt: current.attempt + 1,
    error: null,
  };
}

export function settleConnectionAttempt(
  current: ResourceConnectionState,
  attempt: number,
  phase: "ready" | "failed" | "disconnected",
  error: string | null = null,
): ResourceConnectionState {
  if (attempt !== current.attempt) return current;
  return {
    phase,
    attempt,
    error: phase === "failed" || phase === "disconnected" ? error : null,
  };
}

export function requestConnectionCancellation(
  current: ResourceConnectionState,
): ResourceConnectionState {
  if (
    current.phase !== "resolving" &&
    current.phase !== "connecting" &&
    current.phase !== "reconnecting"
  ) {
    return current;
  }
  return { ...current, phase: "cancelling", error: null };
}

export function disconnectConnection(
  current: ResourceConnectionState,
  error: string | null = null,
): ResourceConnectionState {
  return {
    phase: "disconnected",
    attempt: current.attempt,
    error,
  };
}

export function isConnectionPending(state: ResourceConnectionState): boolean {
  return (
    state.phase === "resolving" ||
    state.phase === "connecting" ||
    state.phase === "reconnecting" ||
    state.phase === "cancelling"
  );
}
