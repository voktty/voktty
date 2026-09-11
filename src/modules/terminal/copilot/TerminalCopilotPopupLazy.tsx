import { lazy, Suspense } from "react";
import type { TerminalCopilotPopupProps } from "./TerminalCopilotPopup";

const TerminalCopilotPopupInner = lazy(() =>
  import("./TerminalCopilotPopup").then((module) => ({
    default: module.TerminalCopilotPopup,
  })),
);

/** The Copilot UI and its AI command generator load only after it is opened. */
export function TerminalCopilotPopupLazy(props: TerminalCopilotPopupProps) {
  return (
    <Suspense fallback={null}>
      <TerminalCopilotPopupInner {...props} />
    </Suspense>
  );
}
