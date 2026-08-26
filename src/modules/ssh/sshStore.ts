import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setSshConnections } from "@/modules/settings/store";
import { parseSshConfig } from "./sshConfigParser";
import type { SshConnection } from "./types";

export function useSshConnections(): SshConnection[] {
  return usePreferencesStore((s) => s.sshConnections ?? []);
}

export async function addSshConnection(
  conn: Omit<SshConnection, "id">,
): Promise<SshConnection> {
  const current = usePreferencesStore.getState().sshConnections ?? [];
  const newConnection: SshConnection = {
    ...conn,
    id: `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  const next = [...current, newConnection];
  await setSshConnections(next);
  return newConnection;
}

export async function updateSshConnection(
  id: string,
  updates: Partial<Omit<SshConnection, "id">>,
): Promise<void> {
  const current = usePreferencesStore.getState().sshConnections ?? [];
  const next = current.map((c) => (c.id === id ? { ...c, ...updates } : c));
  await setSshConnections(next);
}

export async function deleteSshConnection(id: string): Promise<void> {
  const current = usePreferencesStore.getState().sshConnections ?? [];
  const next = current.filter((c) => c.id !== id);
  await setSshConnections(next);
}

export async function importSshConfigHosts(): Promise<{
  importedCount: number;
  totalFound: number;
}> {
  try {
    const home = await homeDir();
    const cleanHome = home.replace(/\\/g, "/").replace(/\/+$/, "");
    const sshConfigPath = `${cleanHome}/.ssh/config`;

    const res = await invoke<{ kind: string; content?: string }>(
      "fs_read_file",
      { path: sshConfigPath },
    );

    if (!res || res.kind !== "text" || !res.content) {
      return { importedCount: 0, totalFound: 0 };
    }

    const parsed = parseSshConfig(res.content);
    if (parsed.length === 0) {
      return { importedCount: 0, totalFound: 0 };
    }

    const current = usePreferencesStore.getState().sshConnections ?? [];
    const existingHosts = new Set(
      current.map((c) => `${c.name.toLowerCase()}::${c.host.toLowerCase()}`),
    );

    const newConnections: SshConnection[] = [];
    for (const p of parsed) {
      const key = `${p.name.toLowerCase()}::${p.host.toLowerCase()}`;
      if (!existingHosts.has(key)) {
        newConnections.push(p);
        existingHosts.add(key);
      }
    }

    if (newConnections.length > 0) {
      await setSshConnections([...current, ...newConnections]);
    }

    return {
      importedCount: newConnections.length,
      totalFound: parsed.length,
    };
  } catch (err) {
    console.warn("[voktty] could not import ~/.ssh/config:", err);
    return { importedCount: 0, totalFound: 0 };
  }
}
