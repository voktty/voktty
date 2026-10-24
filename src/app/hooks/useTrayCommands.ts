import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useRef } from "react";

function ownTrayCommand(event: string, run: () => void): () => void {
  let active = true;
  let onCommand: (() => void) | undefined = run;
  let stop: UnlistenFn | undefined;
  const report = (phase: string, error: unknown) => {
    console.error(`[voktty] tray listener ${phase} failed:`, event, error);
  };
  const release = (unlisten: UnlistenFn) => {
    try {
      void Promise.resolve(unlisten()).catch((error) => report("cleanup", error));
    } catch (error) {
      report("cleanup", error);
    }
  };
  const failed = (error: unknown) => {
    active = false;
    onCommand = undefined;
    report("setup", error);
  };
  try {
    void listen(event, () => { if (active) onCommand?.(); }).then((unlisten) => {
      if (active) stop = unlisten;
      else release(unlisten);
    }, failed);
  } catch (error) {
    failed(error);
  }
  return () => {
    active = false;
    onCommand = undefined;
    const unlisten = stop;
    stop = undefined;
    if (unlisten) release(unlisten);
  };
}

export function useTrayCommands(newTerminal: () => void, newPreview: (url: string) => unknown): void {
  const actions = useRef({ newTerminal, newPreview });
  useLayoutEffect(() => { actions.current = { newTerminal, newPreview }; }, [newTerminal, newPreview]);
  useEffect(() => {
    const stopTerminal = ownTrayCommand("tray:new_terminal", () => actions.current.newTerminal());
    const stopPreview = ownTrayCommand("tray:new_preview", () => { actions.current.newPreview(""); });
    return () => {
      stopTerminal();
      stopPreview();
    };
  }, []);
}
