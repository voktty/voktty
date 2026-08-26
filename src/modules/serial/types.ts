import type { SerialConnectionConfig } from "@/modules/workspace/env";
export type { SerialConnectionConfig };

export type SerialPortDescriptor = {
  port_name: string;
  port_type: string;
  manufacturer?: string;
  product?: string;
  vid?: number;
  pid?: number;
  serial_number?: string;
};

export type SerialOpenOptions = {
  port_name: string;
  baud_rate: number;
  data_bits?: number;
  flow_control?: "none" | "software" | "hardware";
  parity?: "none" | "odd" | "even";
  stop_bits?: number;
};

export type SerialSignals = {
  dtr?: boolean;
  rts?: boolean;
};

export const COMMON_BAUD_RATES = [
  9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 2000000,
] as const;
