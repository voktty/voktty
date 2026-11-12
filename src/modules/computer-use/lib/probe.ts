import { invoke } from "@tauri-apps/api/core";
import { requestRemoteResult } from "@/modules/remote/client";

/** The only place the offered release is written down. */
export const COMPUTER_USE_VERSION = "1.1.4";
export const COMPUTER_USE_PACKAGE = "open-computer-use";
export const COMPUTER_USE_INSTALL_COMMAND = `npm i -g ${COMPUTER_USE_PACKAGE}@${COMPUTER_USE_VERSION}`;
/** Helper capability that reports the install state of a host. */
export const COMPUTER_USE_PROBE_CAPABILITY = "ocu.probe";

export type ComputerUseStatus =
  | "not-installed"
  | "installed"
  | "doctor-problem"
  | "unusable";

export type ComputerUseProbe = {
  status: ComputerUseStatus;
  path: string | null;
  version: string | null;
  /** Bounded `doctor` output; null when diagnostics were not requested. */
  doctor: string | null;
  error: string | null;
};

const STATUSES: ComputerUseStatus[] = [
  "not-installed",
  "installed",
  "doctor-problem",
  "unusable",
];

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

/** Validates what crossed the Tauri or SSH boundary before the UI trusts it. */
export function parseProbe(value: unknown): ComputerUseProbe {
  const raw = (value ?? {}) as Record<string, unknown>;
  const status = STATUSES.find((candidate) => candidate === raw.status);
  if (!status) throw new Error("Invalid computer use probe result");
  return {
    status,
    path: text(raw.path, 1024),
    version: text(raw.version, 64),
    doctor: text(raw.doctor, 2100),
    error: text(raw.error, 300),
  };
}

export async function probeLocalComputerUse(
  runDoctor: boolean,
): Promise<ComputerUseProbe> {
  return parseProbe(await invoke("computer_use_probe", { runDoctor }));
}

export async function probeRemoteComputerUse(
  sessionId: number,
  runDoctor: boolean,
): Promise<ComputerUseProbe> {
  return parseProbe(
    await requestRemoteResult(sessionId, COMPUTER_USE_PROBE_CAPABILITY, {
      doctor: runDoctor,
    }),
  );
}

/** Where a probe or an install runs. `null` host means this computer. */
export type ComputerUseTarget = { hostId: string | null };

export const COMPUTER_USE_INSTALL_EVENT = "voktty://computer-use-install";
