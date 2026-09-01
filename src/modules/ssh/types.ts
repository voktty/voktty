import { invoke } from "@tauri-apps/api/core";
import type { SshConnectionConfig } from "@/modules/workspace";

export type { SshConnectionConfig };

export type SshConnection = SshConnectionConfig & {
  id: string;
  name: string;
};

export type SshPingResult = {
  host: string;
  port: number;
  online: boolean;
  latencyMs?: number;
  error?: string;
};

export type SshServerMetrics = {
  osName: string;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  tcpConnections: number;
  usersCount: number;
  loadAvg: number[];
  pingMs?: number;
};

export async function pingSshHost(
  host: string,
  port?: number,
): Promise<SshPingResult> {
  try {
    return await invoke<SshPingResult>("ssh_ping", { host, port });
  } catch (err) {
    return {
      host,
      port: port ?? 22,
      online: false,
      error: String(err),
    };
  }
}

export async function fetchSshServerMetrics(
  connection: SshConnectionConfig,
): Promise<SshServerMetrics> {
  return invoke<SshServerMetrics>("ssh_fetch_metrics", { connection });
}

export async function fetchLocalHostMetrics(): Promise<SshServerMetrics> {
  return invoke<SshServerMetrics>("host_local_metrics");
}

export type RemoteMultiplexerSession = {
  name: string;
  windowsCount: number;
  attachedCount: number;
  createdAt?: number;
  lastActivity?: number;
  isAttached: boolean;
  multiplexer: string;
};

export type RemoteMultiplexerProbe = {
  supported: boolean;
  multiplexer?: string;
  sessions: RemoteMultiplexerSession[];
};

export async function probeSshMultiplexer(
  connection: SshConnectionConfig,
): Promise<RemoteMultiplexerProbe> {
  return invoke<RemoteMultiplexerProbe>("ssh_list_multiplexer_sessions", {
    connection,
  });
}

export function buildSshCommand(conn: SshConnection): string {
  const parts: string[] = ["ssh"];
  if (conn.port && conn.port !== 22) {
    parts.push(`-p ${conn.port}`);
  }
  if (conn.identityFile && conn.identityFile.trim()) {
    parts.push(`-i "${conn.identityFile.trim()}"`);
  }
  if (conn.extraArgs && conn.extraArgs.trim()) {
    parts.push(conn.extraArgs.trim());
  }
  const destination = conn.user?.trim()
    ? `${conn.user.trim()}@${conn.host.trim()}`
    : conn.host.trim();
  parts.push(destination);

  return parts.join(" ");
}

export function formatSshSubtitle(conn: SshConnection): string {
  const user = conn.user ? `${conn.user}@` : "";
  const port = conn.port && conn.port !== 22 ? `:${conn.port}` : "";
  return `${user}${conn.host}${port}`;
}
