export type TunnelType = "local" | "remote" | "dynamic";

export interface SshTunnelConfig {
  id: string;
  name: string;
  tunnelType: TunnelType;
  localHost?: string;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
  // SSH Server
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
  extraArgs?: string;
  // Metadata & Associations
  connectionId?: string; // Optional link to saved SSH connection
  autoStart?: boolean;
}

export type TunnelStatus = "stopped" | "connecting" | "active" | "error";

export interface TunnelStatusEvent {
  id: string;
  status: TunnelStatus;
  error?: string;
  startedAt?: number;
}

export interface ActiveTunnelState {
  status: TunnelStatus;
  error?: string;
  startedAt?: number;
}

export function formatTunnelDirection(tunnel: SshTunnelConfig): string {
  const localH = tunnel.localHost || "127.0.0.1";
  const remoteH = tunnel.remoteHost || "127.0.0.1";

  switch (tunnel.tunnelType) {
    case "local":
      return `${localH}:${tunnel.localPort} ➔ ${remoteH}:${tunnel.remotePort ?? tunnel.localPort}`;
    case "remote":
      return `Remote :${tunnel.remotePort ?? tunnel.localPort} ➔ ${localH}:${tunnel.localPort}`;
    case "dynamic":
      return `SOCKS5 Proxy on ${localH}:${tunnel.localPort}`;
  }
}

export function buildTunnelSshCommand(tunnel: SshTunnelConfig): string {
  const parts: string[] = ["ssh", "-N"];
  const localH = tunnel.localHost || "127.0.0.1";
  const remoteH = tunnel.remoteHost || "127.0.0.1";

  if (tunnel.tunnelType === "local") {
    parts.push(`-L ${localH}:${tunnel.localPort}:${remoteH}:${tunnel.remotePort ?? tunnel.localPort}`);
  } else if (tunnel.tunnelType === "remote") {
    const rBind = tunnel.remoteHost ? `${tunnel.remoteHost}:` : "";
    parts.push(`-R ${rBind}${tunnel.remotePort ?? tunnel.localPort}:${localH}:${tunnel.localPort}`);
  } else if (tunnel.tunnelType === "dynamic") {
    parts.push(`-D ${localH}:${tunnel.localPort}`);
  }

  if (tunnel.port && tunnel.port !== 22) {
    parts.push(`-p ${tunnel.port}`);
  }
  if (tunnel.identityFile && tunnel.identityFile.trim()) {
    parts.push(`-i "${tunnel.identityFile.trim()}"`);
  }
  if (tunnel.extraArgs && tunnel.extraArgs.trim()) {
    parts.push(tunnel.extraArgs.trim());
  }

  const dest = tunnel.user?.trim()
    ? `${tunnel.user.trim()}@${tunnel.host.trim()}`
    : tunnel.host.trim();
  parts.push(dest);

  return parts.join(" ");
}
