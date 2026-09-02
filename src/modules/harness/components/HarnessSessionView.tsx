import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  appendUser,
  applyHarnessEvent,
  cancelAgyTurn,
  cancelClaudeTurn,
  cancelCodexTurn,
  cancelCursorTurn,
  cancelFxTurn,
  cancelGrokTurn,
  cancelOmpTurn,
  cancelOpenCodeTurn,
  cancelPiTurn,
  respondAgyApproval,
  respondClaudeApproval,
  respondCodexApproval,
  respondCursorApproval,
  respondFxApproval,
  respondGrokApproval,
  respondOmpApproval,
  respondOpenCodeApproval,
  respondPiApproval,
  sendAgyTurn,
  sendClaudeTurn,
  sendCodexTurn,
  sendCursorTurn,
  sendFxTurn,
  sendGrokTurn,
  sendOmpTurn,
  sendOpenCodeTurn,
  sendPiTurn,
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
      setSession({ ...current, busy: true });

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
        switch (current.harness) {
          case "claude":
            await sendClaudeTurn(turnInput);
            break;
          case "codex":
            await sendCodexTurn(turnInput);
            break;
          case "cursor":
            await sendCursorTurn(turnInput);
            break;
          case "opencode":
            await sendOpenCodeTurn(turnInput);
            break;
          case "grok":
            await sendGrokTurn(turnInput);
            break;
          case "pi":
            await sendPiTurn(turnInput);
            break;
          case "omp":
            await sendOmpTurn(turnInput);
            break;
          case "fx":
            await sendFxTurn(turnInput);
            break;
          case "gemini":
            await sendAgyTurn(turnInput);
            break;
        }
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
    switch (current.harness) {
      case "claude":
        void cancelClaudeTurn(sessionId);
        break;
      case "codex":
        void cancelCodexTurn(sessionId);
        break;
      case "cursor":
        void cancelCursorTurn(sessionId);
        break;
      case "opencode":
        void cancelOpenCodeTurn(sessionId);
        break;
      case "grok":
        void cancelGrokTurn(sessionId);
        break;
      case "pi":
        void cancelPiTurn(sessionId);
        break;
      case "omp":
        void cancelOmpTurn(sessionId);
        break;
      case "fx":
        void cancelFxTurn(sessionId);
        break;
      case "gemini":
        void cancelAgyTurn(sessionId);
        break;
    }
    setSession((prev) => (prev ? stopStreaming(prev) : prev));
  }, []);

  const handleApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const current = sessionRef.current;
      if (!current) return;
      switch (current.harness) {
        case "claude":
          void respondClaudeApproval(sessionId, requestId, decision);
          break;
        case "codex":
          void respondCodexApproval(sessionId, requestId, decision);
          break;
        case "cursor":
          void respondCursorApproval(sessionId, requestId, decision);
          break;
        case "opencode":
          void respondOpenCodeApproval(sessionId, requestId, decision);
          break;
        case "grok":
          void respondGrokApproval(sessionId, requestId, decision);
          break;
        case "pi":
          void respondPiApproval(sessionId, requestId, decision);
          break;
        case "omp":
          void respondOmpApproval(sessionId, requestId, decision);
          break;
        case "fx":
          void respondFxApproval(sessionId, requestId, decision);
          break;
        case "gemini":
          void respondAgyApproval(sessionId, requestId, decision);
          break;
      }
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
        onApproval={handleApproval}
        onOpenFile={handleOpenFile}
        onOpenDiff={handleOpenFile}
        onOpenPlan={handleOpenFile}
        onNewTerminal={handleNewTerminal}
      />
    </div>
  );
};
