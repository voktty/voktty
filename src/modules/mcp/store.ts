import { ensureStorageMigrated } from "@/lib/storageMigration";
import { LazyStore } from "@tauri-apps/plugin-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { mcpApi } from "./api";
import { mcpServerSchema, parseStoredMcpServers } from "./mcp.schema";
import type {
  McpCredentialStatus,
  McpErrorKind,
  McpServerConfig,
  McpServerView,
} from "./types";

const STORE_PATH = "voktty-mcp.json";
const SERVERS_KEY = "servers";
const persistentStore = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

type McpStoreState = {
  configs: McpServerConfig[];
  views: Record<string, McpServerView>;
  credentials: Record<string, McpCredentialStatus>;
  busyIds: string[];
  initialized: boolean;
  loading: boolean;
  errorKind: McpErrorKind | null;
  init: () => Promise<void>;
  saveServer: (config: McpServerConfig, bearerToken?: string) => Promise<void>;
  setEnabled: (serverId: string, enabled: boolean) => Promise<void>;
  setAutomaticRead: (serverId: string, toolName: string, enabled: boolean) => Promise<void>;
  connect: (serverId: string) => Promise<void>;
  disconnect: (serverId: string) => Promise<void>;
  restart: (serverId: string) => Promise<void>;
  revokeCredentials: (serverId: string) => Promise<void>;
  authorizeOAuth: (serverId: string) => Promise<void>;
  removeServer: (serverId: string) => Promise<void>;
  clearError: () => void;
};

function errorKind(error: unknown): McpErrorKind {
  if (typeof error === "object" && error !== null && "kind" in error) {
    return String((error as { kind: unknown }).kind) as McpErrorKind;
  }
  return "io";
}

function byId(views: McpServerView[]): Record<string, McpServerView> {
  return Object.fromEntries(views.map((view) => [view.id, view]));
}

async function persist(configs: McpServerConfig[]): Promise<void> {
  await persistentStore.set(SERVERS_KEY, configs);
  await persistentStore.save();
}

export const useMcpStore = create<McpStoreState>((set, get) => {
  const setBusy = (serverId: string, busy: boolean) => {
    set((state) => ({
      busyIds: busy
        ? Array.from(new Set([...state.busyIds, serverId]))
        : state.busyIds.filter((id) => id !== serverId),
    }));
  };

  const applyView = (view: McpServerView) => {
    set((state) => ({
      views: { ...state.views, [view.id]: view },
      errorKind: null,
    }));
  };

  const run = async (serverId: string, action: () => Promise<McpServerView>) => {
    setBusy(serverId, true);
    try {
      applyView(await action());
    } catch (error) {
      set({ errorKind: errorKind(error) });
      try {
        set({ views: byId(await mcpApi.listServers()) });
      } catch {
        // Keep the last trustworthy snapshot when native state is unavailable.
      }
      throw error;
    } finally {
      setBusy(serverId, false);
    }
  };

  return {
    configs: [],
    views: {},
    credentials: {},
    busyIds: [],
    initialized: false,
    loading: false,
    errorKind: null,

    init: async () => {
      if (get().initialized) return;
      set({ initialized: true, loading: true, errorKind: null });
      try {
        await ensureStorageMigrated();
        const configs = parseStoredMcpServers(
          await persistentStore.get<unknown>(SERVERS_KEY),
        );
        set({ configs });
        for (const config of configs) {
          await mcpApi.upsertServer(config);
        }
        const credentials = Object.fromEntries(
          await Promise.all(
            configs.map(async (config) => [
              config.id,
              await mcpApi.credentialStatus(config.id),
            ] as const),
          ),
        );
        set({ credentials, views: byId(await mcpApi.listServers()) });
        for (const config of configs.filter((entry) => entry.enabled)) {
          try {
            applyView(await mcpApi.connectServer(config.id));
          } catch {
            set({ views: byId(await mcpApi.listServers()) });
          }
        }
      } catch (error) {
        set({ errorKind: errorKind(error) });
      } finally {
        set({ loading: false });
      }
    },

    saveServer: async (config, bearerToken) => {
      const parsed = mcpServerSchema.parse(config) as McpServerConfig;
      setBusy(parsed.id, true);
      try {
        const current = get().configs;
        const configs = [...current.filter((entry) => entry.id !== parsed.id), parsed].sort(
          (left, right) => left.name.localeCompare(right.name),
        );
        applyView(await mcpApi.upsertServer(parsed));
        if (parsed.authMode === "bearer" && bearerToken) {
          const status = await mcpApi.setBearerCredential(parsed.id, bearerToken);
          set((state) => ({
            credentials: { ...state.credentials, [parsed.id]: status },
          }));
        }
        await persist(configs);
        set({ configs });
        if (parsed.enabled) applyView(await mcpApi.connectServer(parsed.id));
      } catch (error) {
        set({ errorKind: errorKind(error) });
        throw error;
      } finally {
        setBusy(parsed.id, false);
      }
    },

    setEnabled: async (serverId, enabled) => {
      const config = get().configs.find((entry) => entry.id === serverId);
      if (!config) return;
      const next = { ...config, enabled };
      await get().saveServer(next);
      if (!enabled) await get().disconnect(serverId);
    },

    setAutomaticRead: async (serverId, toolName, enabled) => {
      const config = get().configs.find((entry) => entry.id === serverId);
      if (!config) return;
      const current = new Set(config.automaticReadTools ?? []);
      if (enabled) current.add(toolName);
      else current.delete(toolName);
      await get().saveServer({
        ...config,
        automaticReadTools: Array.from(current).sort(),
      });
    },

    connect: (serverId) => run(serverId, () => mcpApi.connectServer(serverId)),
    disconnect: (serverId) => run(serverId, () => mcpApi.disconnectServer(serverId)),
    restart: (serverId) => run(serverId, () => mcpApi.restartServer(serverId)),

    revokeCredentials: async (serverId) => {
      setBusy(serverId, true);
      try {
        const status = await mcpApi.revokeCredentials(serverId);
        set((state) => ({
          credentials: { ...state.credentials, [serverId]: status },
          views: byId(Object.values(state.views).filter((view) => view.id !== serverId)),
          errorKind: null,
        }));
        set({ views: byId(await mcpApi.listServers()) });
      } catch (error) {
        set({ errorKind: errorKind(error) });
        throw error;
      } finally {
        setBusy(serverId, false);
      }
    },

    authorizeOAuth: async (serverId) => {
      setBusy(serverId, true);
      try {
        try {
          applyView(await mcpApi.connectServer(serverId));
        } catch {
          set({ views: byId(await mcpApi.listServers()) });
        }
        const flow = await mcpApi.beginOAuth(serverId);
        await openUrl(flow.authorizationUrl);
        for (let attempt = 0; attempt < 180; attempt += 1) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
          const status = await mcpApi.oauthFlowStatus(serverId);
          if (status.phase === "pending") continue;
          if (status.phase !== "completed") {
            set({ errorKind: status.errorKind ?? "authentication" });
            return;
          }
          const credential = await mcpApi.credentialStatus(serverId);
          set((state) => ({
            credentials: { ...state.credentials, [serverId]: credential },
            errorKind: null,
          }));
          applyView(await mcpApi.connectServer(serverId));
          return;
        }
        set({ errorKind: "timeout" });
      } catch (error) {
        set({ errorKind: errorKind(error) });
        throw error;
      } finally {
        setBusy(serverId, false);
      }
    },

    removeServer: async (serverId) => {
      setBusy(serverId, true);
      try {
        await mcpApi.removeServer(serverId);
        const configs = get().configs.filter((entry) => entry.id !== serverId);
        await persist(configs);
        set((state) => {
          const views = { ...state.views };
          const credentials = { ...state.credentials };
          delete views[serverId];
          delete credentials[serverId];
          return { configs, views, credentials, errorKind: null };
        });
      } catch (error) {
        set({ errorKind: errorKind(error) });
        throw error;
      } finally {
        setBusy(serverId, false);
      }
    },

    clearError: () => set({ errorKind: null }),
  };
});
