import { invoke } from "@tauri-apps/api/core";
import type { SerialPortDescriptor, SerialSignals } from "./types";

export async function listSerialPorts(): Promise<SerialPortDescriptor[]> {
  try {
    return await invoke<SerialPortDescriptor[]>("serial_list_ports");
  } catch (e) {
    console.error("[voktty] listSerialPorts error:", e);
    return [];
  }
}

export async function setSerialSignals(
  id: number,
  signals: SerialSignals,
): Promise<void> {
  await invoke("serial_set_signals", { id, signals });
}
