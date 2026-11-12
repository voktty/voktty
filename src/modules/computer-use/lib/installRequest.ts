import { COMPUTER_USE_INSTALL_COMMAND } from "./probe";

/** Validates the event payload sent by the settings window. */
export function parseInstallRequest(
  payload: unknown,
): { hostId: string | null } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const hostId = (payload as { hostId?: unknown }).hostId;
  if (hostId === null) return { hostId: null };
  if (typeof hostId === "string" && hostId.length > 0 && hostId.length <= 256) {
    return { hostId };
  }
  return null;
}

/**
 * The text typed into the visible terminal. It is always the pinned command,
 * never anything the event carried.
 */
export function installKeystrokes(): string {
  return `${COMPUTER_USE_INSTALL_COMMAND}\r`;
}
