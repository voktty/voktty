import React, { useLayoutEffect } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { initAppearance } from "./lib/appearance";
import { initSounds } from "./lib/sounds";
import { loadWindowTransfer } from "./lib/windowTransferBootstrap";
import {
  handleQuitRequested,
  loadResumedWorkspace,
} from "./lib/appLifecycle";
import "./index.css";

initAppearance();
initSounds();

function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.dataset.dismissed === "1") return;
  splash.dataset.dismissed = "1";
  splash.classList.add("boot-splash-out");
  window.setTimeout(() => splash.remove(), 140);
}

function BootGate({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    dismissBootSplash();
  }, []);
  return children;
}

async function boot() {
  await listen("quit_requested", () => {
    void handleQuitRequested();
  });
  const windowTransfer = await loadWindowTransfer();
  const resumed = windowTransfer ? null : await loadResumedWorkspace();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <BootGate>
        <App windowTransfer={windowTransfer} resumed={resumed} />
      </BootGate>
    </React.StrictMode>,
  );
}

void boot();
