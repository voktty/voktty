import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type WebServerInfo = {
  url: string;
  port: number;
  root_path: string;
  server_type: "static" | "php";
};

export function extractLocalPort(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return parsed.port ? parseInt(parsed.port, 10) : null;
    }
  } catch {
    const match = url.match(/(?:localhost|127\.0\.0\.1):(\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

type WebServerState = {
  servers: Record<string, WebServerInfo>;
  startServer: (path: string, port?: number) => Promise<WebServerInfo>;
  stopServer: (path: string) => Promise<void>;
  stopServerByUrl: (url: string) => Promise<void>;
  getServerForPath: (path: string) => Promise<WebServerInfo | null>;
  listServers: () => Promise<WebServerInfo[]>;
};

export const useWebServerStore = create<WebServerState>((set) => ({
  servers: {},

  startServer: async (path: string, port?: number) => {
    try {
      const info = await invoke<WebServerInfo>("web_server_start", {
        path,
        port: port ?? null,
      });
      set((state) => ({
        servers: {
          ...state.servers,
          [info.root_path]: info,
        },
      }));
      return info;
    } catch (err) {
      console.error("Failed to start web server:", err);
      throw err;
    }
  },

  stopServer: async (path: string) => {
    try {
      await invoke("web_server_stop", { path, port: null });
      set((state) => {
        const next = { ...state.servers };
        delete next[path];
        return { servers: next };
      });
    } catch (err) {
      console.error("Failed to stop web server:", err);
      throw err;
    }
  },

  stopServerByUrl: async (url: string) => {
    const port = extractLocalPort(url);
    if (port) {
      try {
        await invoke("web_server_stop", { path: null, port });
        set((state) => {
          const next = { ...state.servers };
          for (const [p, s] of Object.entries(next)) {
            if (s.port === port) {
              delete next[p];
            }
          }
          return { servers: next };
        });
      } catch (err) {
        console.error("Failed to stop web server by url:", err);
      }
    }
  },

  getServerForPath: async (path: string) => {
    try {
      const info = await invoke<WebServerInfo | null>(
        "web_server_get_for_path",
        { path },
      );
      if (info) {
        set((state) => ({
          servers: {
            ...state.servers,
            [info.root_path]: info,
          },
        }));
      }
      return info;
    } catch (err) {
      console.error("Failed to get web server for path:", err);
      return null;
    }
  },

  listServers: async () => {
    try {
      const list = await invoke<WebServerInfo[]>("web_server_list");
      const mapped: Record<string, WebServerInfo> = {};
      for (const item of list) {
        mapped[item.root_path] = item;
      }
      set({ servers: mapped });
      return list;
    } catch (err) {
      console.error("Failed to list web servers:", err);
      return [];
    }
  },
}));
