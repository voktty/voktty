import React, { useLayoutEffect } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
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
void revealLaunchWindow();

function splashRgb() {
  const splash = document.getElementById("boot-splash");
  const bg = splash
    ? getComputedStyle(splash).backgroundColor
    : "rgb(23, 23, 23)";
  const parts = bg.match(/\d+/g);
  if (!parts || parts.length < 3) return { r: 23, g: 23, b: 23 };
  return {
    r: Number(parts[0]),
    g: Number(parts[1]),
    b: Number(parts[2]),
  };
}

async function revealLaunchWindow() {
  const img = document.querySelector<HTMLImageElement>("#boot-splash img");
  if (img && !img.complete) {
    await new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await invoke("reveal_launch_window", splashRgb());
}

function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.dataset.dismissed === "1") return;
  splash.dataset.dismissed = "1";
  const fade = () => {
    void invoke("enable_window_glass");
    splash.classList.add("boot-splash-out");
    window.setTimeout(() => splash.remove(), 180);
  };
  // useLayoutEffect runs before paint. Two frames later the app is on
  // screen, so the fade reveals UI instead of the desktop blur.
  requestAnimationFrame(() => {
    requestAnimationFrame(fade);
  });
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
