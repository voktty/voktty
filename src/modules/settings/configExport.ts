import type { SshConnection } from "@/modules/ssh/types";
import type { SshTunnelConfig } from "@/modules/ssh/tunnels/types";
import { usePreferencesStore } from "./preferences";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  writePreferencesBatch,
} from "./store";

export const CONFIG_SCHEMA_VERSION = 1;
export const CONFIG_APP_ID = "voktty";

export type VokttyExportedConfig = {
  $schema?: string;
  version: number;
  app: "voktty";
  exportedAt: string;
  preferences: Partial<Preferences>;
  sshConnections?: SshConnection[];
  sshTunnels?: SshTunnelConfig[];
};

export type ImportResult = {
  success: boolean;
  importedPreferencesCount: number;
  importedSshCount: number;
  error?: string;
};

/**
 * Filter and sanitize SSH connections to ensure no secrets or runtime states are exported.
 */
export function sanitizeSshConnections(
  connections: unknown,
): SshConnection[] {
  if (!Array.isArray(connections)) return [];
  return connections
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => {
      const sanitized: SshConnection = {
        id: typeof c.id === "string" && c.id ? c.id : `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: typeof c.name === "string" && c.name ? c.name : String(c.host ?? "SSH Host"),
        host: typeof c.host === "string" ? c.host : "",
      };
      if (typeof c.user === "string" && c.user) sanitized.user = c.user;
      if (typeof c.port === "number" && !Number.isNaN(c.port)) sanitized.port = c.port;
      if (typeof c.identityFile === "string" && c.identityFile) sanitized.identityFile = c.identityFile;
      if (typeof c.extraArgs === "string" && c.extraArgs) sanitized.extraArgs = c.extraArgs;
      if (typeof c.initialDirectory === "string" && c.initialDirectory) sanitized.initialDirectory = c.initialDirectory;
      return sanitized;
    })
    .filter((c) => c.host.trim().length > 0);
}

export function sanitizeSshTunnels(
  tunnels: unknown,
): SshTunnelConfig[] {
  if (!Array.isArray(tunnels)) return [];
  return tunnels
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => {
      const sanitized: SshTunnelConfig = {
        id: typeof t.id === "string" && t.id ? t.id : `tun-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: typeof t.name === "string" && t.name ? t.name : "Port Forwarding",
        tunnelType: t.tunnelType === "remote" || t.tunnelType === "dynamic" ? t.tunnelType : "local",
        localHost: typeof t.localHost === "string" ? t.localHost : "127.0.0.1",
        localPort: typeof t.localPort === "number" ? t.localPort : 3306,
        host: typeof t.host === "string" ? t.host : "",
      };
      if (typeof t.remoteHost === "string") sanitized.remoteHost = t.remoteHost;
      if (typeof t.remotePort === "number") sanitized.remotePort = t.remotePort;
      if (typeof t.port === "number") sanitized.port = t.port;
      if (typeof t.user === "string") sanitized.user = t.user;
      if (typeof t.identityFile === "string") sanitized.identityFile = t.identityFile;
      if (typeof t.extraArgs === "string") sanitized.extraArgs = t.extraArgs;
      if (typeof t.connectionId === "string") sanitized.connectionId = t.connectionId;
      if (typeof t.autoStart === "boolean") sanitized.autoStart = t.autoStart;
      return sanitized;
    })
    .filter((t) => t.host.trim().length > 0 || Boolean(t.connectionId));
}

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const patterns = [
    "password",
    "apikey",
    "api_key",
    "secret",
    "token",
    "private_key",
    "privatekey",
    "passphrase",
    "credential",
    "bearer",
    "auth_key",
    "authorization",
  ];
  return patterns.some((p) => lower.includes(p));
}

/**
 * Strips secret tokens, passwords, and sensitive keys from any arbitrary object.
 */
export function stripSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    if (Array.isArray(value)) {
      clean[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? stripSensitiveFields(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === "object" && value !== null) {
      clean[key] = stripSensitiveFields(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Generates the clean, exportable configuration object.
 */
export function exportConfiguration(
  currentPreferences?: Partial<Preferences>,
): VokttyExportedConfig {
  const raw = currentPreferences ?? usePreferencesStore.getState();

  // Extract all Preferences keys
  const prefs: Partial<Preferences> = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]) {
    if (key in raw && raw[key] !== undefined) {
      prefs[key] = raw[key] as never;
    }
  }

  // Sanitize SSH connections & Tunnels
  const ssh = sanitizeSshConnections(raw.sshConnections ?? []);
  const tunnels = sanitizeSshTunnels(raw.sshTunnels ?? []);
  prefs.sshConnections = ssh;
  prefs.sshTunnels = tunnels;

  // Clean any nested fields
  const sanitizedPrefs = stripSensitiveFields(
    prefs as unknown as Record<string, unknown>,
  ) as unknown as Partial<Preferences>;

  return {
    $schema: "https://voktty.dev/schemas/config-v1.json",
    version: CONFIG_SCHEMA_VERSION,
    app: CONFIG_APP_ID,
    exportedAt: new Date().toISOString(),
    preferences: sanitizedPrefs,
    sshConnections: ssh,
    sshTunnels: tunnels,
  };
}

/**
 * Triggers a browser/webview file download of the exported configuration.
 */
export function downloadConfiguration(
  config?: VokttyExportedConfig,
  filename?: string,
): void {
  const data = config ?? exportConfiguration();
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const defaultName = `voktty-config-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Validates and parses raw JSON string into a structured configuration object.
 */
export function validateAndParseConfig(jsonText: string): {
  valid: boolean;
  config?: VokttyExportedConfig;
  preferences?: Partial<Preferences>;
  sshConnections?: SshConnection[];
  sshTunnels?: SshTunnelConfig[];
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: "Invalid JSON format: expected an object" };
    }

    let preferences: Partial<Preferences> = {};
    let sshConnections: SshConnection[] = [];
    let sshTunnels: SshTunnelConfig[] = [];

    // Check if wrapped in standard Voktty configuration format
    if ("preferences" in parsed && typeof parsed.preferences === "object" && parsed.preferences !== null) {
      preferences = stripSensitiveFields(parsed.preferences) as unknown as Partial<Preferences>;
      if (Array.isArray(parsed.sshConnections)) {
        sshConnections = sanitizeSshConnections(parsed.sshConnections);
      } else if (Array.isArray(preferences.sshConnections)) {
        sshConnections = sanitizeSshConnections(preferences.sshConnections);
      }
      if (Array.isArray(parsed.sshTunnels)) {
        sshTunnels = sanitizeSshTunnels(parsed.sshTunnels);
      } else if (Array.isArray(preferences.sshTunnels)) {
        sshTunnels = sanitizeSshTunnels(preferences.sshTunnels);
      }
    } else {
      // Direct preferences object
      preferences = stripSensitiveFields(parsed) as unknown as Partial<Preferences>;
      if (Array.isArray(parsed.sshConnections)) {
        sshConnections = sanitizeSshConnections(parsed.sshConnections);
      }
      if (Array.isArray(parsed.sshTunnels)) {
        sshTunnels = sanitizeSshTunnels(parsed.sshTunnels);
      }
    }

    return {
      valid: true,
      config: {
        version: typeof parsed.version === "number" ? parsed.version : CONFIG_SCHEMA_VERSION,
        app: CONFIG_APP_ID,
        exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
        preferences,
        sshConnections,
        sshTunnels,
      },
      preferences,
      sshConnections,
      sshTunnels,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Malformed JSON file",
    };
  }
}

/**
 * Imports configuration into Voktty store and live state.
 */
export async function importConfiguration(
  rawInput: string | Record<string, unknown>,
  options: { mergeSsh?: boolean } = { mergeSsh: true },
): Promise<ImportResult> {
  const parsedResult =
    typeof rawInput === "string"
      ? validateAndParseConfig(rawInput)
      : validateAndParseConfig(JSON.stringify(rawInput));

  if (!parsedResult.valid || !parsedResult.preferences) {
    return {
      success: false,
      importedPreferencesCount: 0,
      importedSshCount: 0,
      error: parsedResult.error ?? "Invalid configuration",
    };
  }

  const incomingPrefs = { ...parsedResult.preferences };
  const incomingSsh = parsedResult.sshConnections ?? [];

  // Handle SSH connections merging / replacing
  const currentSsh = usePreferencesStore.getState().sshConnections ?? [];
  let finalSsh: SshConnection[] = incomingSsh;

  if (options.mergeSsh) {
    const existingById = new Map(currentSsh.map((c) => [c.id, c]));
    for (const conn of incomingSsh) {
      existingById.set(conn.id, conn);
    }
    finalSsh = Array.from(existingById.values());
  }

  incomingPrefs.sshConnections = finalSsh;

  // Handle SSH Tunnels merging / replacing
  const currentTunnels = usePreferencesStore.getState().sshTunnels ?? [];
  const incomingTunnels = parsedResult.sshTunnels ?? [];
  let finalTunnels: SshTunnelConfig[] = incomingTunnels;

  if (options.mergeSsh) {
    const existingById = new Map(currentTunnels.map((t) => [t.id, t]));
    for (const tun of incomingTunnels) {
      existingById.set(tun.id, tun);
    }
    finalTunnels = Array.from(existingById.values());
  }

  incomingPrefs.sshTunnels = finalTunnels;

  // Filter only recognized preference keys
  const validBatch: Partial<Preferences> = {};
  let prefCount = 0;

  for (const [key, value] of Object.entries(incomingPrefs)) {
    if (key in DEFAULT_PREFERENCES && value !== undefined) {
      validBatch[key as keyof Preferences] = value as never;
      prefCount++;
    }
  }

  try {
    await writePreferencesBatch(validBatch);
    usePreferencesStore.setState(validBatch);

    return {
      success: true,
      importedPreferencesCount: prefCount,
      importedSshCount: incomingSsh.length,
    };
  } catch (err) {
    return {
      success: false,
      importedPreferencesCount: 0,
      importedSshCount: 0,
      error: err instanceof Error ? err.message : "Failed to persist imported settings",
    };
  }
}
