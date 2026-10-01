import React from "react";
import ReactDOM from "react-dom/client";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { applyDocumentLocale, loadLocale, readFastLanguage } from "@/modules/i18n";
import { ThemeProvider } from "@/modules/theme";
import { QuickGitPopup } from "./ui/QuickGitPopup";
import { QuickComposer } from "./ui/QuickComposer";
import "@/styles/globals.css";

const startupLanguage = readFastLanguage();
await loadLocale(startupLanguage);
applyDocumentLocale(startupLanguage);

document.documentElement.dataset.platform = IS_WINDOWS
  ? "windows"
  : IS_MAC
    ? "macos"
    : "linux";

function onShown() {}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      {new URLSearchParams(window.location.search).get("popup") === "git" ? (
        <QuickGitPopup onShown={onShown} />
      ) : (
        <QuickComposer onShown={onShown} />
      )}
    </ThemeProvider>
  </React.StrictMode>,
);
