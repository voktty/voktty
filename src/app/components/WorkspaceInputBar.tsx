import { AiInputBarConnect } from "@/modules/ai";
import { Chip } from "@/modules/ai/components/Chip";
import { ChipsRow } from "@/modules/ai/components/ChipsRow";
import { useComposer } from "@/modules/ai/lib/composer";
import { useTranslation } from "@/modules/i18n";
import { useBlockController } from "@/modules/terminal/lib/blockController";
import {
  CommandLineIcon,
  Folder01Icon,
  GitBranchIcon,
} from "@hugeicons/core-free-icons";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { OsIcon } from "./OsIcon";
import { useGitBranch } from "./useGitBranch";
import { useSystemInfo } from "./useSystemInfo";

const ShellInput = lazy(() => import("@/modules/terminal/block/ShellInput"));
const AiComposerInput = lazy(() =>
  import("@/modules/ai/components/AiComposerInput").then((m) => ({
    default: m.AiComposerInput,
  })),
);

type Props = {
  isBlockTab: boolean;
  isTerminalTab: boolean;
  activeLeafId: number | null;
  cwd?: string | null;
  home?: string | null;
  hasComposer: boolean;
  panelOpen: boolean;
  keysLoaded: boolean;
  onConnect: () => void;
  placement?: "workspace" | "sidebar" | "mini";
  miniOpen?: boolean;
};

export function WorkspaceInputBar({
  isBlockTab,
  isTerminalTab,
  activeLeafId,
  cwd,
  home,
  hasComposer,
  panelOpen,
  keysLoaded,
  onConnect,
  placement = "workspace",
  miniOpen = false,
}: Props) {
  const inSidebar = placement === "sidebar";
  const inMini = placement === "mini";
  const inEmbedded = inSidebar || inMini;
  const c = useComposer();
  const { t } = useTranslation();
  const { os, shell } = useSystemInfo();

  const controller = useBlockController(isBlockTab ? activeLeafId : null);
  const blockMode = controller?.blockMode ?? "prompt";

  // Re-resolve the branch chip when a command finishes (covers `git checkout`).
  const [promptNonce, setPromptNonce] = useState(0);
  const prevBlockMode = useRef(blockMode);
  useEffect(() => {
    if (prevBlockMode.current !== "prompt" && blockMode === "prompt") {
      setPromptNonce((n) => n + 1);
    }
    prevBlockMode.current = blockMode;
  }, [blockMode]);
  const branch = useGitBranch(isTerminalTab ? (cwd ?? null) : null, promptNonce);

  const effectiveMode = inEmbedded ? "ai" : "shell";
  const mounted = keysLoaded || isBlockTab || inEmbedded;
  const open = inEmbedded || (!panelOpen && !miniOpen && isBlockTab);

  const [aiLoaded, setAiLoaded] = useState(false);
  useEffect(() => {
    if (open && effectiveMode === "ai") setAiLoaded(true);
  }, [open, effectiveMode]);
  // The provider owns one shared textarea ref. Keep the AI composer mounted
  // only in the visible input surface so a hidden workspace bar cannot steal
  // focus from the sidebar composer when the panel is open.
  const renderAi = hasComposer && aiLoaded && open;

  if (!mounted) return null;

  const terminalChips =
    !inEmbedded && isTerminalTab ? (
      <>
        {os && <Chip tone="neutral" iconNode={<OsIcon os={os} />} title={os} />}
        {cwd && (
          <Chip tone="blue" icon={Folder01Icon} title={cwd}>
            {relPath(cwd, home)}
          </Chip>
        )}
        {branch && (
          <Chip
            tone="violet"
            icon={GitBranchIcon}
            title={t("git.branchName", { name: branch })}
          >
            {branch}
          </Chip>
        )}
        {shell && (
          <Chip tone="emerald" icon={CommandLineIcon}>
            {shell}
          </Chip>
        )}
      </>
    ) : null;

  const content =
    !hasComposer && (inEmbedded || !isBlockTab) ? (
      <AiInputBarConnect onAdd={onConnect} />
    ) : (
      <div className="shrink-0 border-t border-border/60 bg-foreground/[0.02] px-3 py-2">
        <div className="flex flex-col gap-2 rounded-lg px-1 py-1">
          <ChipsRow
            leading={terminalChips}
            files={c.files}
            onRemoveFile={c.removeFile}
            snippets={c.pickedSnippets}
            onRemoveSnippet={(id) => {
              const snip = c.pickedSnippets.find((s) => s.id === id);
              c.removeSnippet(id);
              if (!snip) return;
              const re = new RegExp(`(^|\\s)#${snip.handle}\\b ?`);
              c.setValue((v) => v.replace(re, (_m, lead: string) => lead));
            }}
            commands={c.pickedCommands}
            onRemoveCommand={(name) => c.removeCommand(name)}
          />

          <div className="flex items-end gap-2.5">
            <div className="relative min-w-0 flex-1">
              {!inEmbedded && isBlockTab && controller && activeLeafId != null && (
                <Suspense fallback={null}>
                  <ShellInput
                    leafId={activeLeafId}
                    mode={blockMode}
                    focused
                    onSubmit={controller.submitCommand}
                    onInterrupt={controller.interrupt}
                    getCwd={controller.getCwd}
                  />
                </Suspense>
              )}
              {inEmbedded && renderAi && (
                <Suspense fallback={null}>
                  <AiComposerInput />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div
      data-ai-input-bar
      data-state={open ? "open" : "closed"}
      className="voktty-reveal"
      aria-hidden={!open}
    >
      <div>{content}</div>
    </div>
  );
}

function relPath(p: string | null | undefined, home: string | null | undefined): string {
  if (typeof p !== "string" || !p) return "";
  if (typeof home !== "string" || !home) return p;
  const h = home.replace(/\/+$/, "");
  if (p === h || p.startsWith(`${h}/`)) return `~${p.slice(h.length)}`;
  return p;
}
