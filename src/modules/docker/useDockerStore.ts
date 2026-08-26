import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type {
  DockerContainerInfo,
  DockerContainerStats,
  DockerDaemonStatus,
} from "./types";

interface DockerState {
  status: DockerDaemonStatus | null;
  containers: DockerContainerInfo[];
  stats: Record<string, DockerContainerStats>;
  loading: boolean;
  error: string | null;
  logsModalContainer: DockerContainerInfo | null;

  setLogsModalContainer: (container: DockerContainerInfo | null) => void;
  pingDaemon: (customHost?: string) => Promise<DockerDaemonStatus>;
  refreshContainers: (customHost?: string) => Promise<void>;
  fetchStats: (containerId: string, customHost?: string) => Promise<DockerContainerStats | null>;
  performAction: (containerId: string, action: string, customHost?: string) => Promise<void>;
  fetchLogs: (containerId: string, tail?: number, customHost?: string) => Promise<string>;
}

export const useDockerStore = create<DockerState>((set, get) => ({
  status: null,
  containers: [],
  stats: {},
  loading: false,
  error: null,
  logsModalContainer: null,

  setLogsModalContainer: (container) => {
    set({ logsModalContainer: container });
  },

  pingDaemon: async (customHost?: string) => {
    try {
      const status = await invoke<DockerDaemonStatus>("docker_ping", {
        customHost: customHost || null,
      });
      set({ status, error: status.error ?? null });
      return status;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const fallbackStatus: DockerDaemonStatus = {
        connected: false,
        version: null,
        os: null,
        containers_running: 0,
        containers_total: 0,
        images_count: 0,
        driver: null,
        error: errorMsg,
      };
      set({ status: fallbackStatus, error: errorMsg });
      return fallbackStatus;
    }
  },

  refreshContainers: async (customHost?: string) => {
    set({ loading: true, error: null });
    try {
      // Also ping status in parallel
      get().pingDaemon(customHost);

      const containers = await invoke<DockerContainerInfo[]>(
        "docker_list_containers",
        {
          all: true,
          customHost: customHost || null,
        },
      );
      set({ containers, loading: false });

      // Fetch stats for all running containers
      const runningContainers = containers.filter((c) => c.state === "running");
      for (const rc of runningContainers.slice(0, 8)) {
        get().fetchStats(rc.id, customHost);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      set({ loading: false, error: errorMsg });
    }
  },

  fetchStats: async (containerId: string, customHost?: string) => {
    try {
      const stats = await invoke<DockerContainerStats>("docker_get_stats", {
        containerId,
        customHost: customHost || null,
      });
      set((state) => ({
        stats: {
          ...state.stats,
          [containerId]: stats,
        },
      }));
      return stats;
    } catch {
      return null;
    }
  },

  performAction: async (containerId: string, action: string, customHost?: string) => {
    try {
      await invoke("docker_container_action", {
        containerId,
        action,
        customHost: customHost || null,
      });
      // Refresh list after action
      await get().refreshContainers(customHost);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      set({ error: errorMsg });
      throw e;
    }
  },

  fetchLogs: async (containerId: string, tail?: number, customHost?: string) => {
    return invoke<string>("docker_get_logs", {
      containerId,
      tail: tail ?? 100,
      customHost: customHost || null,
    });
  },
}));
