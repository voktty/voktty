import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { GuestSessionBadge } from "@/modules/collab/components/GuestSessionBadge";
import { HostSessionBadge } from "@/modules/collab/components/HostSessionBadge";
import type { ResourceConnectionState } from "@/modules/connections/lifecycle";
import { useTranslation } from "@/modules/i18n";
import { useTheme } from "@/modules/theme";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  Cancel01Icon,
  Loading03Icon,
  Refresh01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { BlockOverlay } from "./block/BlockOverlay";
import { BlockWatermark } from "./block/BlockWatermark";
import { TerminalCopilotPopup } from "./copilot/TerminalCopilotPopup";
import { useTerminalCopilotStore } from "./copilot/terminalCopilotStore";
import {
  focusLeafInput,
  leafCwd,
  submitToLeaf,
  useTerminalSession,
} from "./lib/useTerminalSession";
import { ProjectScriptsHud } from "./scripts/ProjectScriptsHud";
import { TerminalScrollBottomHud } from "./TerminalScrollBottomHud";

function ConnectionStatusBadge({
  workspaceEnv,
  status,
  onReconnect,
  onCancel,
}: {
  workspaceEnv?: WorkspaceEnv;
  status: ResourceConnectionState;
  onReconnect: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!workspaceEnv || workspaceEnv.kind === "local") {
    return null;
  }

  const title =
    workspaceEnv.kind === "ssh"
      ? workspaceEnv.connection.name || workspaceEnv.connection.host
      : workspaceEnv.kind === "serial"
        ? workspaceEnv.portName
        : workspaceEnv.kind === "docker"
          ? workspaceEnv.connection.containerName ||
            workspaceEnv.connection.containerId.slice(0, 12)
          : `WSL · ${workspaceEnv.distro}`;
  const pending =
    status.phase === "resolving" ||
    status.phase === "connecting" ||
    status.phase === "reconnecting" ||
    status.phase === "cancelling";

  if (pending) {
    const label =
      status.phase === "reconnecting"
        ? t("terminal.connection.reconnecting", { name: title })
        : status.phase === "cancelling"
          ? t("terminal.connection.cancelling", { name: title })
          : t("terminal.connection.connecting", { name: title });
    const subLabel =
      workspaceEnv.kind === "wsl"
        ? t("workspace.startingWslDistro")
        : t("workspace.establishingConnection");

    return (
      <>
        <div
          role="status"
          aria-live="polite"
          className="absolute right-3 top-3 z-30 flex items-center gap-2 rounded-md border border-primary/30 bg-background/90 px-2.5 py-1 text-[11px] shadow-lg backdrop-blur-md animate-in fade-in-0 duration-200"
        >
          <HugeiconsIcon
            icon={Loading03Icon}
            size={12}
            strokeWidth={2}
            className="animate-spin text-primary"
          />
          <span className="font-medium text-foreground">{label}</span>
          {status.phase !== "cancelling" && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-border/60 bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-accent/80 cursor-pointer"
            >
              {t("common.cancel")}
            </button>
          )}
        </div>
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-xs animate-in fade-in-0 duration-200">
          <div className="flex size-11 items-center justify-center rounded-xl border border-border/80 bg-card/90 shadow-md">
            <HugeiconsIcon
              icon={Loading03Icon}
              size={22}
              strokeWidth={2}
              className="animate-spin text-primary"
            />
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-xs font-semibold text-foreground">
              {label}
            </span>
            <span className="text-[11px] text-muted-foreground">{subLabel}</span>
          </div>
        </div>
      </>
    );
  }

  if (status.phase === "disconnected" || status.phase === "failed") {
    return (
      <div
        role="alert"
        className="absolute right-3 top-3 z-30 flex max-w-[min(42rem,calc(100%-1.5rem))] items-center gap-2.5 rounded-md border border-destructive/40 bg-card/95 px-3 py-1.5 text-[11px] shadow-xl backdrop-blur-md animate-in fade-in-0 duration-200"
      >
        <span className="size-2 rounded-full bg-destructive animate-pulse" />
        <span className="min-w-0 font-medium text-foreground">
          <span className="block truncate">
            {status.phase === "failed"
              ? t("terminal.connection.failed", { name: title })
              : t("terminal.connection.disconnected", { name: title })}
          </span>
          {status.error && (
            <span
              className="block max-w-96 truncate font-mono text-[9px] font-normal text-muted-foreground"
              title={status.error}
            >
              {status.error}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onReconnect}
          className="flex items-center gap-1 rounded bg-accent hover:bg-accent/80 text-foreground px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer border border-border/60"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={2} />
          <span>{t("terminal.connection.retry")}</span>
        </button>
      </div>
    );
  }

  return null;
}

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  workspaceEnv?: WorkspaceEnv;
  shellOverride?: string;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
};

export const TerminalPane = memo(
  forwardRef<TerminalPaneHandle, Props>(function TerminalPane(
    {
      leafId,
      visible,
      focused = true,
      initialCwd,
      workspaceEnv,
      shellOverride,
      blocks = false,
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const downYRef = useRef<number | null>(null);
    const { resolvedMode, activeTheme } = useTheme();

    const [currentCwd, setCurrentCwd] = useState<string | null>(
      initialCwd ?? leafCwd(leafId) ?? null,
    );

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      workspaceEnv,
      shellOverride,
      blocks,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => {
        setCurrentCwd(c);
        onCwd?.(leafId, c);
      },
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, activeTheme, session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
      }),
      [session],
    );

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    const { t } = useTranslation();
    const aiAvailable = useAiAvailable();
    const promptReady = session.blockMode === "prompt";
    const copilotRequested = useTerminalCopilotStore(
      (s) => s.isOpen && (s.leafId === null || s.leafId === leafId),
    );
    const copilotOpen = aiAvailable && copilotRequested;
    const initialPrompt = useTerminalCopilotStore((s) => s.initialPrompt);
    const closeCopilot = useTerminalCopilotStore((s) => s.closeCopilot);

    const handleFixTerminalError = (exitCode: number) => {
      const buf = session.getBuffer(40) ?? "";
      const prompt = t("terminal.block.fixErrorPrompt", {
        code: String(exitCode),
        output: buf,
      });
      const chat = useChatStore.getState();
      if (!chat.activeSessionId) {
        chat.newSession();
      }
      chat.openPanel();
      chat.focusInput(prompt);
      session.clearFailedExit();
    };

    if (blocks) {
      return (
        <div
          className="zoom-exempt flex h-full w-full flex-col"
          style={hideStyle}
        >
          <ProjectScriptsHud
            cwd={currentCwd ?? leafCwd(leafId) ?? initialCwd}
            onRun={(cmd) => submitToLeaf(leafId, cmd)}
            onInsert={(cmd) => {
              session.write(cmd);
              if (session.blockMode === "prompt") focusLeafInput(leafId);
              else session.focus();
            }}
          />
          <div className="relative min-h-0 flex-1">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects command blocks */}
            <div
              ref={containerRef}
              className="absolute inset-0 z-0 overflow-hidden bg-background"
              style={{ contain: "strict", isolation: "isolate" }}
              onMouseDown={(e) => {
                downYRef.current = e.clientY;
              }}
              onMouseUp={(e) => {
                const moved =
                  downYRef.current != null &&
                  Math.abs(e.clientY - downYRef.current) > 4;
                downYRef.current = null;
                if (!moved) session.selectBlockAt(e.clientY);
                if (session.blockMode === "prompt") focusLeafInput(leafId);
              }}
            />
            <BlockWatermark
              leafId={leafId}
              subscribe={session.subscribeBlocks}
            />
            <ErrorBoundary name="Block Overlay">
              <BlockOverlay
                subscribe={session.subscribeBlocks}
                getVisible={session.visibleBlocks}
                readOutput={(id) => session.readBlockId(id)?.output ?? null}
                searchBlock={session.searchBlock}
                revealMatch={session.revealMatch}
                clearSearch={session.clearSearch}
                promptReady={promptReady}
                onRunAgain={(cmd) => submitToLeaf(leafId, cmd)}
                onRestoreFocus={() => {
                  if (session.blockMode === "prompt") focusLeafInput(leafId);
                }}
              />
            </ErrorBoundary>
            {copilotOpen && (
              <ErrorBoundary name="Terminal Copilot">
                <TerminalCopilotPopup
                  leafId={leafId}
                  active={copilotOpen}
                  cwd={currentCwd ?? leafCwd(leafId) ?? initialCwd}
                  workspaceEnv={workspaceEnv}
                  initialPrompt={initialPrompt}
                  onInsert={(cmd) => {
                    session.write(cmd);
                    if (session.blockMode === "prompt") focusLeafInput(leafId);
                    else session.focus();
                  }}
                  onExecute={(cmd) => {
                    submitToLeaf(leafId, cmd);
                    if (session.blockMode === "prompt") focusLeafInput(leafId);
                    else session.focus();
                  }}
                  onClose={() => {
                    closeCopilot();
                    if (session.blockMode === "prompt") focusLeafInput(leafId);
                    else session.focus();
                  }}
                />
              </ErrorBoundary>
            )}
            <TerminalScrollBottomHud leafId={leafId} visible={visible} />
            <HostSessionBadge leafId={leafId} />
            <GuestSessionBadge leafId={leafId} onReconnect={session.respawn} />
            <ConnectionStatusBadge
              workspaceEnv={workspaceEnv}
              status={session.connectionState}
              onReconnect={session.respawn}
              onCancel={session.cancelConnection}
            />
          </div>
        </div>
      );
    }

    return (
      <div
        className="zoom-exempt flex h-full w-full flex-col"
        style={hideStyle}
      >
        <ProjectScriptsHud
          cwd={currentCwd ?? leafCwd(leafId) ?? initialCwd}
          onRun={(cmd) => submitToLeaf(leafId, cmd)}
          onInsert={(cmd) => {
            session.write(cmd);
            session.focus();
          }}
        />
        <div className="relative min-h-0 flex-1">
          <div
            ref={containerRef}
            className="h-full w-full overflow-hidden bg-background"
            style={{ contain: "strict", isolation: "isolate" }}
          />
          {!blocks && aiAvailable && session.failedExit !== null && (
            <div className="absolute right-4 top-3 z-20 flex items-center gap-2 rounded-lg border border-destructive/40 bg-card/95 px-3 py-1.5 text-xs shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150">
              <span className="flex size-2 rounded-full bg-destructive animate-pulse" />
              <span className="font-mono text-[11px] font-medium text-destructive">
                {t("terminal.block.exitCode", {
                  code: String(session.failedExit),
                })}
              </span>
              <button
                type="button"
                onClick={() => handleFixTerminalError(session.failedExit!)}
                className="flex items-center gap-1 rounded bg-destructive/15 hover:bg-destructive/25 text-destructive px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
                title={t("terminal.block.fixWithAiTitle")}
              >
                <HugeiconsIcon icon={SparklesIcon} size={11} strokeWidth={2} />
                <span>{t("terminal.block.fixWithAi")}</span>
              </button>
              <button
                type="button"
                onClick={() => session.clearFailedExit()}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                title={t("terminal.block.close")}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
              </button>
            </div>
          )}
          {copilotOpen && (
            <ErrorBoundary name="Terminal Copilot">
              <TerminalCopilotPopup
                leafId={leafId}
                active={copilotOpen}
                cwd={leafCwd(leafId)}
                workspaceEnv={workspaceEnv}
                initialPrompt={initialPrompt}
                onInsert={(cmd) => {
                  session.write(cmd);
                  session.focus();
                }}
                onExecute={(cmd) => {
                  submitToLeaf(leafId, cmd);
                  session.focus();
                }}
                onClose={() => {
                  closeCopilot();
                  session.focus();
                }}
              />
            </ErrorBoundary>
          )}
          <TerminalScrollBottomHud leafId={leafId} visible={visible} />
          <HostSessionBadge leafId={leafId} />
          <GuestSessionBadge leafId={leafId} onReconnect={session.respawn} />
          <ConnectionStatusBadge
            workspaceEnv={workspaceEnv}
            status={session.connectionState}
            onReconnect={session.respawn}
            onCancel={session.cancelConnection}
          />
        </div>
      </div>
    );
  }),
);
