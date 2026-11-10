import "../styles/globals.css";

import { emit, listen } from "@tauri-apps/api/event";
import ReactDOM from "react-dom/client";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { HarnessNotch } from "@/modules/harness/chrome/HarnessNotch";
import {
  NOTCH_ACTION_EVENT,
  NOTCH_READY_EVENT,
  NOTCH_STATE_EVENT,
  type NotchAction,
  type NotchSnapshot,
} from "@/modules/harness/lib/notchBridge";
import { useNotchStore } from "@/modules/harness/lib/notchStore";
import { applyDocumentLocale, loadLocale, readFastLanguage } from "@/modules/i18n";
import { ThemeProvider } from "@/modules/theme";

const startupLanguage = readFastLanguage();
await loadLocale(startupLanguage);
applyDocumentLocale(startupLanguage);

document.documentElement.dataset.platform = IS_WINDOWS
  ? "windows"
  : IS_MAC
    ? "macos"
    : "linux";

// The overlay owns no agent state: it mirrors what the main window publishes
// and sends the user's decisions back.
const sendAction = (action: NotchAction) => {
  void emit(NOTCH_ACTION_EVENT, action).catch(() => undefined);
};

await listen<NotchSnapshot>(NOTCH_STATE_EVENT, ({ payload }) => {
  useNotchStore.getState().syncHarnessState({
    liveAgents: payload.liveAgents,
    sessions: payload.sessions,
    onApproval: (sessionId, approvalId, decision) =>
      sendAction({ kind: "approval", sessionId, approvalId, decision }),
  });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ThemeProvider>
    <HarnessNotch mode="overlay" />
  </ThemeProvider>,
);

// Ask for the current state once the listener exists.
void emit(NOTCH_READY_EVENT).catch(() => undefined);
