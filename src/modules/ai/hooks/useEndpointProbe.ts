import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { probeErrorDetail } from "../lib/probeErrorDetail";

type ProbeState = {
  url: string;
  status: "idle" | "testing" | "ok" | "fail";
  detail?: string;
};

export function useEndpointProbe(baseURL: string) {
  const url = baseURL.trim();
  const latestUrl = useRef(url);
  latestUrl.current = url;
  const generation = useRef(0);
  const [state, setState] = useState<ProbeState>({ url, status: "idle" });
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [url]);

  const test = async () => {
    const attempt = ++generation.current;
    setState({ url, status: "testing" });
    try {
      const status = await invoke<number>("lm_ping", { baseUrl: url });
      if (attempt === generation.current && latestUrl.current === url)
        setState({ url, status: status > 0 ? "ok" : "fail" });
    } catch (error) {
      if (attempt === generation.current && latestUrl.current === url)
        setState({ url, status: "fail", detail: probeErrorDetail(error) });
    }
  };
  return {
    status: state.url === url ? state.status : ("idle" as const),
    detail: state.url === url ? state.detail : undefined,
    test,
  };
}
