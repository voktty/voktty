import type { SshConnection } from "./types";

export function parseSshConfig(content: string): SshConnection[] {
  const connections: SshConnection[] = [];
  const lines = content.split(/\r?\n/);

  let current: Partial<SshConnection> | null = null;

  for (let rawLine of lines) {
    const commentIdx = rawLine.indexOf("#");
    if (commentIdx >= 0) {
      rawLine = rawLine.slice(0, commentIdx);
    }
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const key = parts[0].toLowerCase();
    const value = parts.slice(1).join(" ").trim();

    if (key === "host") {
      // Ignore wildcards
      if (value === "*" || value.includes("*") || value.includes("?")) {
        if (current?.host) {
          connections.push(finalizeConnection(current));
        }
        current = null;
        continue;
      }

      if (current && (current.host || current.name)) {
        connections.push(finalizeConnection(current));
      }

      current = {
        id: `ssh-config-${value}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: value,
        host: value,
      };
    } else if (current) {
      if (key === "hostname") {
        current.host = value;
      } else if (key === "user") {
        current.user = value;
      } else if (key === "port") {
        const p = parseInt(value, 10);
        if (!Number.isNaN(p) && p > 0) current.port = p;
      } else if (key === "identityfile") {
        current.identityFile = value;
      }
    }
  }

  if (current && (current.host || current.name)) {
    connections.push(finalizeConnection(current));
  }

  return connections;
}

function finalizeConnection(c: Partial<SshConnection>): SshConnection {
  return {
    id: c.id || `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: c.name || c.host || "SSH Server",
    host: c.host || c.name || "localhost",
    user: c.user,
    port: c.port,
    identityFile: c.identityFile,
    extraArgs: c.extraArgs,
  };
}
