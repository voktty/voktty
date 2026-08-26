import "../styles/globals.css";

import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { ThemeProvider } from "@/modules/theme";
import { applyDocumentLocale, readFastLanguage } from "@/modules/i18n";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import ReactDOM from "react-dom/client";
import { SettingsApp } from "./SettingsApp";

applyDocumentLocale(readFastLanguage());

document.documentElement.dataset.platform = IS_WINDOWS
  ? "windows"
  : IS_MAC
    ? "macos"
    : "linux";

if (IS_LINUX || IS_WINDOWS) {
  document.documentElement.dataset.chrome = "borderless";
}

ReactDOM.createRoot(
  document.getElementById("settings-root") as HTMLElement,
).render(
  <ThemeProvider>
    <SettingsApp />
  </ThemeProvider>,
);

const showWindow = () => {
  const win = getCurrentWebviewWindow();
  win
    .show()
    .then(() => win.setFocus())
    .catch((e) => console.error("settings show failed:", e));
};
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);
