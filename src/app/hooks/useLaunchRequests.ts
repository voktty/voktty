import {
  createLaunchRequestDeduper,
  getLaunchBootstrap,
  type LaunchRequest,
} from "@/lib/launchRequest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

type Params = {
  ready: boolean;
  onRequest: (request: LaunchRequest) => void | Promise<void>;
};

export function useLaunchRequests({ ready, onRequest }: Params): void {
  const deduper = useRef(createLaunchRequestDeduper());

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const apply = async (request: LaunchRequest) => {
      if (!deduper.current.begin(request.requestId)) {
        await invoke("launch_acknowledge", {
          requestId: request.requestId,
        }).catch(() => false);
        return;
      }
      try {
        await onRequest(request);
        deduper.current.complete(request.requestId);
        await invoke("launch_acknowledge", {
          requestId: request.requestId,
        });
      } catch (error) {
        deduper.current.fail(request.requestId);
        console.error("[voktty] launch request failed:", error);
      }
    };

    void listen<LaunchRequest>("voktty:launch-request", (event) => {
      void apply(event.payload);
    })
      .then(async (stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        const queued = await invoke<LaunchRequest[]>("launch_frontend_ready", {
          ready: true,
        });
        const initial = getLaunchBootstrap().requests;
        for (const request of [...initial, ...queued]) await apply(request);
      })
      .catch((error) => {
        console.error("[voktty] launch bridge setup failed:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
      void invoke("launch_frontend_ready", { ready: false }).catch(() => []);
    };
  }, [ready, onRequest]);
}
