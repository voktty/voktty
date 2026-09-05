import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendUser,
  applyHarnessEvent,
  cancelHarnessTurn,
  respondHarnessApproval,
  sendHarnessTurn,
  startHarnessBridge,
  stopStreaming,
} from "../lib/harness";
import type { ApprovalDecision, HarnessEvent, SendTurnInput } from "../lib/harness/types";
import { defaultSessionChoice } from "../lib/models";
import { loadRecents, rememberProject, type RecentProject } from "../lib/recents";
import type {
  Attachment,
  HarnessId,
  RuntimeMode,
  Session,
} from "../lib/session";
import { SessionPane } from "../surfaces/SessionPane";

type HarnessSessionViewProps = {
  sessionId?: string;
  cwd: string;
};

export const HarnessSessionView: React.FC<HarnessSessionViewProps> = ({
  sessionId: initialSessionId,
  cwd: initialCwd,
}) => {
  const [recents, setRecents] = useState<RecentProject[]>(() => {
    const loaded = loadRecents();
    if (initialCwd) {
      return rememberProject(initialCwd);
    }
    return loaded;
  });

  const effectiveCwd = initialCwd || recents[0]?.path || "";

  const [session, setSession] = useState<Session>(() => {
    const choice = defaultSessionChoice();
    const id = initialSessionId || `session-${Date.now()}`;
    return {
      id,
      cwd: effectiveCwd,
      harness: choice.harness,
      model: choice.model,
      modelSettings: {},
      runtimeMode: "supervised",
      title: "New Session",
      blocks: [],
      busy: false,
    };
  });

  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Start the Tauri bridge event listeners (stdout, stderr, exit) on mount
  useEffect(() => {
    const stopBridge = startHarnessBridge();
    return () => {
      stopBridge();
    };
  }, []);

  useEffect(() => {
    if (session.cwd && session.cwd !== "~") {
      window.dispatchEvent(
        new CustomEvent("voktty:harness-cwd-change", {
          detail: { cwd: session.cwd },
        }),
      );
    }
  }, [session.cwd]);

  const handleCwdChange = useCallback((sessionId: string, newCwd: string) => {
    setSession((prev) => (prev && prev.id === sessionId ? { ...prev, cwd: newCwd } : prev));
    setRecents(rememberProject(newCwd));
  }, []);

  const handleBranchChange = useCallback((_sessionId: string) => {
    // Branch changed via branch picker
  }, []);

  const handleModelChange = useCallback(
    (sessionId: string, harness: HarnessId, model: string) => {
      setSession((prev) =>
        prev && prev.id === sessionId ? { ...prev, harness, model } : prev,
      );
    },
    [],
  );

  const handleModelSettingsChange = useCallback(
    (sessionId: string, settings: Record<string, string>) => {
      setSession((prev) =>
        prev && prev.id === sessionId
          ? { ...prev, modelSettings: { ...prev.modelSettings, ...settings } }
          : prev,
      );
    },
    [],
  );

  const handleRuntimeModeChange = useCallback(
    (sessionId: string, mode: RuntimeMode) => {
      setSession((prev) =>
        prev && prev.id === sessionId ? { ...prev, runtimeMode: mode } : prev,
      );
    },
    [],
  );

  const handleSubmit = useCallback(
    async (sessionId: string, text: string, attachments: Attachment[]) => {
      let current = sessionRef.current;
      if (!current || current.id !== sessionId) return;

      current = appendUser(current, text, attachments);
      const title =
        current.title === "New Session" && text.trim()
          ? text.trim().slice(0, 48)
          : current.title;
      setSession({ ...current, title, busy: true });

      const onEvent = (event: HarnessEvent) => {
        setSession((prev) => (prev ? applyHarnessEvent(prev, event) : prev));
      };

      const turnInput: SendTurnInput = {
        sessionId: current.id,
        cwd: current.cwd,
        model: current.model,
        modelSettings: current.modelSettings,
        runtimeMode: current.runtimeMode,
        text,
        attachments,
        onEvent,
      };

      try {
        await sendHarnessTurn({ ...turnInput, harness: current.harness });
      } catch (err: any) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                busy: false,
                blocks: [
                  ...prev.blocks,
                  {
                    id: `err-${Date.now()}`,
                    role: "system",
                    text: `Error: ${err?.message || String(err)}`,
                  },
                ],
              }
            : prev,
        );
      }
    },
    [],
  );

  const handleStop = useCallback((sessionId: string) => {
    const current = sessionRef.current;
    if (!current) return;
    void cancelHarnessTurn(current.harness, sessionId);
    setSession((prev) => (prev ? stopStreaming(prev) : prev));
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".voktty-terminal, .monocode-terminal")) {
        return;
      }
      const current = sessionRef.current;
      if (!current || !current.busy) return;

      queueMicrotask(() => {
        if (!event.defaultPrevented && sessionRef.current?.busy) {
          handleStop(sessionRef.current.id);
        }
      });
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [handleStop]);

  const handleApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const current = sessionRef.current;
      if (!current) return;
      respondHarnessApproval(current.harness, sessionId, requestId, decision);
    },
    [],
  );

  const handleOpenFile = useCallback((path?: string) => {
    if (!path) return;
    window.dispatchEvent(
      new CustomEvent("voktty:open-dropped-path", { detail: path }),
    );
  }, []);

  const handleNewTerminal = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("voktty:open-new-terminal-tab", {
        detail: { cwd: sessionRef.current?.cwd },
      }),
    );
  }, []);

  return (
    <div className="h-full w-full bg-[#121215] text-white flex flex-col overflow-hidden select-text font-sans">
      <SessionPane
        session={session}
        visible={true}
        focused={true}
        inSplit={false}
        showHeader={true}
        composerFocused={true}
        recents={recents}
        onFocus={() => {}}
        onClose={() => {}}
        onCwdChange={handleCwdChange}
        onBranchChange={handleBranchChange}
        onModelChange={handleModelChange}
        onModelSettingsChange={handleModelSettingsChange}
        onRuntimeModeChange={handleRuntimeModeChange}
        onSubmit={handleSubmit}
        onStop={handleStop}
        onCompactContext={() => false}
        onApproval={handleApproval}
        onOpenFile={handleOpenFile}
        onOpenDiff={handleOpenFile}
        onOpenPlan={handleOpenFile}
        onNewTerminal={handleNewTerminal}
      />
    </div>
  );
};
