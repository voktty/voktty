import { Channel, invoke } from "@tauri-apps/api/core";
import { t } from "@/modules/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RdpConnectOptions, RdpEvent, RdpInput, RdpSessionState } from "../types";
import { getRdpScancode } from "./scancodes";

export function useRdpSession(initialOptions?: RdpConnectOptions | null) {
  const [state, setState] = useState<RdpSessionState>("disconnected");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number }>({
    width: 1280,
    height: 800,
  });

  const sessionIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mountedRef = useRef(true);
  const attemptedKeyRef = useRef<string | null>(null);

  const sendInput = useCallback((input: RdpInput) => {
    const id = sessionIdRef.current;
    if (id === null) return;
    void invoke("rdp_send_input", { id, input }).catch((err) => {
      console.warn("[RDP] Failed to send input:", err);
    });
  }, []);

  const sendKey = useCallback(
    (code: string, pressed: boolean) => {
      const entry = getRdpScancode(code);
      if (!entry) return;
      sendInput({
        type: "key",
        scancode: entry.scancode,
        pressed,
        extended: entry.extended,
      });
    },
    [sendInput],
  );

  const sendCtrlAltDel = useCallback(() => {
    // Ctrl down, Alt down, Del down, Del up, Alt up, Ctrl up
    sendInput({ type: "key", scancode: 0x1d, pressed: true, extended: false });
    sendInput({ type: "key", scancode: 0x38, pressed: true, extended: false });
    sendInput({ type: "key", scancode: 0x53, pressed: true, extended: true });
    setTimeout(() => {
      sendInput({ type: "key", scancode: 0x53, pressed: false, extended: true });
      sendInput({ type: "key", scancode: 0x38, pressed: false, extended: false });
      sendInput({ type: "key", scancode: 0x1d, pressed: false, extended: false });
    }, 50);
  }, [sendInput]);

  const sendWinKey = useCallback(() => {
    sendInput({ type: "key", scancode: 0x5b, pressed: true, extended: true });
    setTimeout(() => {
      sendInput({ type: "key", scancode: 0x5b, pressed: false, extended: true });
    }, 50);
  }, [sendInput]);

  const disconnect = useCallback(() => {
    const id = sessionIdRef.current;
    if (id !== null) {
      sessionIdRef.current = null;
      void invoke("rdp_disconnect", { id }).catch(() => {});
    }
    setState("disconnected");
    setStatusMessage(null);
  }, []);

  const launchNative = useCallback(
    async (host: string, port?: number, username?: string) => {
      try {
        await invoke("rdp_launch_native", {
          host,
          port: port || 3389,
          username: username || undefined,
        });
      } catch (e) {
        console.error("[RDP] Failed to launch native RDP client:", e);
      }
    },
    [],
  );

  const connect = useCallback(
    async (options: RdpConnectOptions) => {
      const prevId = sessionIdRef.current;
      if (prevId !== null) {
        sessionIdRef.current = null;
        void invoke("rdp_disconnect", { id: prevId }).catch(() => {});
      }

      setError(null);
      setState("connecting");
      setStatusMessage(
        t("feedback.rdpConnecting", {
          host: options.host,
          port: options.port || 3389,
        }),
      );

      const channel = new Channel<RdpEvent>();
      channel.onmessage = (event) => {
        if (!mountedRef.current) return;
        switch (event.type) {
          case "connecting":
            setStatusMessage(event.payload.status);
            break;
          case "connected":
            setState("connected");
            setStatusMessage(null);
            setError(null);
            setResolution({
              width: event.payload.width,
              height: event.payload.height,
            });
            break;
          case "bitmap": {
            const canvas = canvasRef.current;
            if (!canvas) break;
            const ctx = canvas.getContext("2d");
            if (!ctx) break;
            try {
              const binary = atob(event.payload.data);
              const bytes = new Uint8ClampedArray(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              const imgData = new ImageData(
                bytes,
                event.payload.width,
                event.payload.height,
              );
              ctx.putImageData(imgData, event.payload.x, event.payload.y);
            } catch (e) {
              console.warn("[RDP] Error rendering bitmap chunk:", e);
            }
            break;
          }
          case "clipboard":
            if (event.payload.text) {
              void navigator.clipboard.writeText(event.payload.text).catch(() => {});
            }
            break;
          case "error":
            setError(event.payload.message);
            setState("error");
            break;
          case "disconnected":
            if (event.payload.reason) {
              setError(t("feedback.rdpDisconnected", { reason: event.payload.reason }));
              setState("error");
            } else {
              setState("disconnected");
            }
            break;
        }
      };

      try {
        const id = await invoke<number>("rdp_connect", {
          options,
          onEvent: channel,
        });
        if (mountedRef.current) {
          sessionIdRef.current = id;
        } else {
          void invoke("rdp_disconnect", { id }).catch(() => {});
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(String(err));
          setState("error");
        }
      }
    },
    [],
  );

  const initialHost = initialOptions?.host;
  const initialPort = initialOptions?.port;
  const initialUser = initialOptions?.username;

  useEffect(() => {
    mountedRef.current = true;
    const key = initialHost ? `${initialHost}:${initialPort || 3389}:${initialUser || ""}` : null;

    if (key && attemptedKeyRef.current !== key && initialOptions) {
      attemptedKeyRef.current = key;
      void connect(initialOptions);
    }

    return () => {
      mountedRef.current = false;
      const id = sessionIdRef.current;
      if (id !== null) {
        sessionIdRef.current = null;
        void invoke("rdp_disconnect", { id }).catch(() => {});
      }
    };
  }, [initialHost, initialPort, initialUser, connect]);

  return {
    state,
    statusMessage,
    error,
    resolution,
    canvasRef,
    connect,
    disconnect,
    launchNative,
    sendInput,
    sendKey,
    sendCtrlAltDel,
    sendWinKey,
  };
}
