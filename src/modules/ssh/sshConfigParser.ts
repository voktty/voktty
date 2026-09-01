import type { SshConnection } from "./types";

export function parseSshConfig(content: string): SshConnection[] {
  const connections: SshConnection[] = [];
  const lines = content.split(/\r?\n/);

  let current: Partial<SshConnection> | null = null;
  let currentExtraOpts: string[] = [];

  const finalize = () => {
    if (current && (current.host || current.name)) {
      if (currentExtraOpts.length > 0) {
        const combined = current.extraArgs
          ? `${current.extraArgs} ${currentExtraOpts.join(" ")}`
          : currentExtraOpts.join(" ");
        current.extraArgs = combined.trim();
      }
      connections.push(finalizeConnection(current));
    }
    current = null;
    currentExtraOpts = [];
  };

  for (let rawLine of lines) {
    const commentIdx = rawLine.indexOf("#");
    if (commentIdx >= 0) {
      rawLine = rawLine.slice(0, commentIdx);
    }
    const line = rawLine.trim();
    if (!line) continue;

    // Parse key and value, supporting both space and '=' separators
    let key = "";
    let value = "";
    const eqIdx = line.indexOf("=");
    const spaceIdx = line.search(/\s/);

    if (eqIdx !== -1 && (spaceIdx === -1 || eqIdx < spaceIdx)) {
      key = line.slice(0, eqIdx).trim();
      value = line.slice(eqIdx + 1).trim();
    } else if (spaceIdx !== -1) {
      key = line.slice(0, spaceIdx).trim();
      value = line.slice(spaceIdx + 1).trim().replace(/^=\s*/, "");
    } else {
      continue;
    }

    if (!key || !value) continue;

    // Strip surrounding quotes from value if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const keyLower = key.toLowerCase();

    if (keyLower === "host") {
      // Ignore wildcards
      if (value === "*" || value.includes("*") || value.includes("?")) {
        finalize();
        continue;
      }

      finalize();

      const hostAlias = value.split(/\s+/)[0];
      current = {
        id: `ssh-config-${hostAlias}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: hostAlias,
        host: hostAlias,
      };
      currentExtraOpts = [];
    } else if (keyLower === "match") {
      // Ignore match blocks
      finalize();
    } else if (current) {
      if (keyLower === "hostname") {
        current.host = value;
      } else if (keyLower === "user") {
        current.user = value;
      } else if (keyLower === "port") {
        const p = parseInt(value, 10);
        if (!Number.isNaN(p) && p > 0) current.port = p;
      } else if (keyLower === "identityfile") {
        current.identityFile = value;
      } else if (keyLower === "extraargs" || keyLower === "extra_args") {
        currentExtraOpts.push(value);
      } else {
        // Any other SSH config directive (HostKeyAlias, StrictHostKeyChecking, UserKnownHostsFile, LogLevel, ProxyJump, etc.)
        if (value.includes(" ") && !value.startsWith('"')) {
          currentExtraOpts.push(`-o "${key}=${value}"`);
        } else {
          currentExtraOpts.push(`-o ${key}=${value}`);
        }
      }
    }
  }

  finalize();

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
    initialDirectory: c.initialDirectory,
  };
}
