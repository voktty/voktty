import { useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  fileWrittenWithin,
  parseFileWritten,
  type FileWrittenEvent,
} from "@/modules/workspace/fileWritten";
import {
  useWebServerStore,
  type WebServerInfo,
} from "@/modules/preview/store/webServerStore";
import { isLocalUrl } from "@/modules/preview/lib/urlSafety";
import { saveAffectsRemotePreview } from "@/modules/preview/lib/previewTunnels";

export function usePreviewFileReload(
  url: string,
  loaded: boolean,
  reload: (isCurrent: () => boolean) => void,
) {
  const owner = useRef<object | null>(null);
  const reloadRef = useRef(reload);
  useLayoutEffect(() => {
    reloadRef.current = reload;
  });
  useLayoutEffect(() => {
    const receipt = { url, loaded };
    owner.current = receipt;
    return () => {
      if (owner.current === receipt) owner.current = null;
    };
  }, [url, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const receipt = owner.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => active && owner.current === receipt;
    const schedule = (server?: WebServerInfo) => {
      if (!current()) return;
      if (timer !== undefined) clearTimeout(timer);
      const valid = () =>
        current() &&
        (!server ||
          useWebServerStore.getState().servers[server.root_path] === server);
      timer = setTimeout(() => {
        if (valid()) reloadRef.current(valid);
      }, 120);
    };
    const matchingServer = (event: FileWrittenEvent) => {
      if (event.filesystem.kind !== "local" || !isLocalUrl(url)) return;
      const target = new URL(url);
      if (target.protocol !== "http:") return;
      return Object.values(useWebServerStore.getState().servers).find(
        (server) =>
          String(server.port) === (target.port || "80") &&
          fileWrittenWithin(event, server.root_path, { kind: "local" }),
      );
    };
    const written = getCurrentWebviewWindow()
      .listen<unknown>("fs:file-written", (event) => {
        if (!current()) return;
        const payload = parseFileWritten(event.payload);
        const server = payload ? matchingServer(payload) : undefined;
        if (server) schedule(server);
      })
      .catch(() => () => {});
    const changed = getCurrentWebviewWindow()
      .listen<unknown>("fs:changed", (event) => {
        if (!current() || !event.payload || typeof event.payload !== "object")
          return;
        const payload = event.payload as {
          paths?: unknown;
          sessionId?: unknown;
        };
        if (
          payload.sessionId !== undefined ||
          !Array.isArray(payload.paths) ||
          payload.paths.length > 20000
        )
          return;
        for (const path of payload.paths) {
          const entry = parseFileWritten({
            path,
            filesystem: { kind: "local" },
          });
          const server = entry ? matchingServer(entry) : undefined;
          if (server) {
            schedule(server);
            return;
          }
        }
      })
      .catch(() => () => {});
    const remoteSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; path?: unknown }>)
        .detail;
      if (
        typeof detail?.sessionId === "number" &&
        typeof detail.path === "string" &&
        saveAffectsRemotePreview(url, {
          sessionId: detail.sessionId,
          path: detail.path,
        })
      ) {
        schedule();
      }
    };
    window.addEventListener("voktty:remote-file-saved", remoteSaved);
    const manual = () => schedule();
    window.addEventListener("voktty:reload-preview", manual);
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("voktty:reload-preview", manual);
      window.removeEventListener("voktty:remote-file-saved", remoteSaved);
      void written.then((unlisten) => unlisten());
      void changed.then((unlisten) => unlisten());
    };
  }, [url, loaded]);
}
