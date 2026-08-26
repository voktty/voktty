import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { initLaunchRequests } from "./lib/launchRequest";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "./lib/platform";

document.documentElement.dataset.platform = IS_WINDOWS
  ? "windows"
  : IS_MAC
    ? "macos"
    : "linux";

if (IS_LINUX || IS_WINDOWS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Suppress native webview/browser context menus (inspect, reload, print, etc.)
// Custom UI components (tabs, files, editor, etc.) use Radix context menus and portals.
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

// Suppress native webview/browser actions (find, print, reload, inspect)
window.addEventListener("keydown", (event) => {
  const isMod = IS_MAC ? event.metaKey : event.ctrlKey;

  // Suppress browser native in-page find bar (F3, Ctrl+F, Cmd+F, Ctrl+G, Cmd+G)
  if (
    event.key === "F3" ||
    (isMod &&
      (event.key === "f" ||
        event.key === "F" ||
        event.key === "g" ||
        event.key === "G"))
  ) {
    event.preventDefault();
  }

  // Suppress browser native print dialog (Ctrl+P / Cmd+P)
  if (isMod && (event.key === "p" || event.key === "P")) {
    event.preventDefault();
  }

  // Disable F5 / Ctrl+R / Cmd+R webview reload in non-development modes
  if (!import.meta.env.DEV) {
    if (
      event.key === "F5" ||
      (isMod && (event.key === "r" || event.key === "R"))
    ) {
      event.preventDefault();
    }
    // Disable F12 / Ctrl+Shift+I inspect element in production
    if (
      event.key === "F12" ||
      (isMod && event.shiftKey && (event.key === "I" || event.key === "i"))
    ) {
      event.preventDefault();
    }
  }
});

// Render-instrumentation overlay, opt-in: `VITE_REACT_SCAN=true pnpm dev`.
// Dev-only dynamic import so it never reaches the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true") {
  const { scan } = await import("react-scan");
  scan({ enabled: true });
}

// Reap PTY sessions orphaned by a prior webview load before any tab spawns.
// Seed before first paint so default tab mounts at target cwd (no flicker).
await Promise.all([
  invoke("pty_close_all").catch(() => {}),
  initLaunchRequests(),
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);

// Window starts hidden (per tauri.conf.json) so users never see a transparent
// shadow-only frame before React paints. Use setTimeout — rAF is throttled
// while the window is hidden and would never fire.
const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);
