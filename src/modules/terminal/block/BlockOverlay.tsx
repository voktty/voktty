import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Clock01Icon,
  CommandLineIcon,
  ComputerTerminal02Icon,
  Copy01Icon,
  MoreHorizontalIcon,
  Refresh01Icon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  BlockMatch,
  PositionedBlock,
  VisibleBlocks,
} from "./lib/blockDecorations";
import { capAttachOutput } from "./lib/outputCap";

let cachedHome: string | null = null;
void homeDir()
  .then((h) => {
    cachedHome = h.replace(/\/+$/, "");
  })
  .catch(() => {});

type Props = {
  subscribe: (cb: () => void) => () => void;
  getVisible: () => VisibleBlocks;
  readOutput: (id: string) => string | null;
  searchBlock: (id: string, query: string) => BlockMatch[];
  revealMatch: (m: BlockMatch) => void;
  clearSearch: () => void;
  promptReady: boolean;
  onRunAgain: (command: string) => void;
  onRestoreFocus: () => void;
};

const EMPTY: VisibleBlocks = { blocks: [], sticky: null };

function fmtDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60000);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function relPath(p: string): string {
  if (cachedHome && (p === cachedHome || p.startsWith(`${cachedHome}/`))) {
    return `~${p.slice(cachedHome.length)}`;
  }
  return p;
}

function copy(text: string, message: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(message))
    .catch(() => {});
}

function signature(v: VisibleBlocks): string {
  let s = v.sticky?.id ?? "";
  for (const b of v.blocks) {
    s += `|${b.id}:${Math.round(b.top)}:${Math.round(b.bottom)}:${b.running}`;
  }
  return s;
}

export function BlockOverlay(props: Props) {
  const { subscribe, getVisible } = props;
  const [vis, setVis] = useState<VisibleBlocks>(EMPTY);
  const [searchId, setSearchId] = useState<string | null>(null);
  const lastSig = useRef("");

  useEffect(() => {
    const update = () => {
      const v = getVisible();
      const sig = signature(v);
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      setVis(v);
    };
    update();
    return subscribe(update);
  }, [subscribe, getVisible]);

  const closeSearch = () => {
    props.clearSearch();
    setSearchId(null);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {vis.blocks.map((b) => (
        <BlockChrome key={b.id} block={b} all={props} onSearch={setSearchId} />
      ))}
      {vis.sticky && (
        <StickyHeader block={vis.sticky} all={props} onSearch={setSearchId} />
      )}
      {searchId && (
        <SearchBar
          blockId={searchId}
          searchBlock={props.searchBlock}
          revealMatch={props.revealMatch}
          onClose={closeSearch}
        />
      )}
    </div>
  );
}

type ChromeProps = {
  block: PositionedBlock;
  all: Props;
  onSearch: (id: string) => void;
};

function BlockChrome({ block, all, onSearch }: ChromeProps) {
  if (block.running) return null;
  const isRecent = block.finishedAt && Date.now() - block.finishedAt < 2500;
  return (
    <>
      {isRecent && (
        <div
          className={cn(
            "pointer-events-none absolute left-0 right-0 rounded-md",
            block.ok ? "bt-result-ready-flash" : "bt-result-fail-flash",
          )}
          style={{
            top: block.top,
            height: Math.max(18, block.bottom - block.top),
          }}
        />
      )}
      <div
        className={cn("bt-divider", !block.ok && "bt-divider-fail")}
        style={{ top: block.bottom }}
      />
      <div className="bt-bar" style={{ top: block.headerTop }}>
        <Meta block={block} />
        <Toolbar block={block} all={all} onSearch={onSearch} />
      </div>
    </>
  );
}

function Meta({ block }: { block: PositionedBlock }) {
  return (
    <span className="bt-head-meta">
      {block.cwd && <span className="bt-cwd">{relPath(block.cwd)}</span>}
      <span className="bt-clock">
        <HugeiconsIcon icon={Clock01Icon} size={11} strokeWidth={1.75} />
        {fmtTime(block.startedAt)}
      </span>
    </span>
  );
}

function StickyHeader({ block, all, onSearch }: ChromeProps) {
  const { t } = useTranslation();
  return (
    <div className="bt-sticky">
      <HugeiconsIcon
        className="bt-sticky-icon"
        icon={CommandLineIcon}
        size={12}
        strokeWidth={1.75}
      />
      <span className="bt-sticky-cmd">
        {block.command || t("terminal.block.commandFallback")}
      </span>
      <Toolbar block={block} all={all} onSearch={onSearch} />
    </div>
  );
}

function Toolbar({ block, all, onSearch }: ChromeProps) {
  const { t } = useTranslation();
  const aiAvailable = useAiAvailable();
  const duration = block.running
    ? null
    : fmtDuration(block.finishedAt - block.startedAt);
  const failed = !block.running && !block.ok && block.exitCode !== null;

  const handleFixWithAi = () => {
    const output = capAttachOutput(all.readOutput(block.id) ?? "");
    const prompt = `The command \`${block.command}\` failed with exit code ${block.exitCode}:\n\`\`\`\n${output}\n\`\`\`\nHow do I fix this error? If a corrected command is needed, suggest it.`;
    const chat = useChatStore.getState();
    chat.openPanel();
    chat.focusInput(prompt);
  };

  return (
    <div className="bt-tools">
      {failed && aiAvailable && (
        <span className="bt-exit">
          {t("terminal.block.exitCode", { code: String(block.exitCode) })}
        </span>
      )}
      {failed && (
        <button
          type="button"
          onClick={handleFixWithAi}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors cursor-pointer"
          title={t("terminal.block.fixWithAiTitle")}
        >
          <HugeiconsIcon icon={SparklesIcon} size={11} strokeWidth={2} />
          <span>{t("terminal.block.fixWithAi")}</span>
        </button>
      )}
      {duration && <span className="bt-dur">{duration}</span>}
      {!block.running && !!block.command && (
        <button
          type="button"
          title={t("terminal.block.runAgain")}
          className="bt-btn"
          disabled={!all.promptReady}
          onClick={() => all.onRunAgain(block.command)}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={12.5} strokeWidth={1.75} />
        </button>
      )}
      <BlockMenu block={block} all={all} onSearch={onSearch} />
    </div>
  );
}

function BlockMenu({ block, all, onSearch }: ChromeProps) {
  const { t } = useTranslation();
  const aiAvailable = useAiAvailable();
  const output = () => all.readOutput(block.id) ?? "";
  const failed = !block.running && !block.ok && block.exitCode !== null;

  const attach = () => {
    const out = capAttachOutput(output());
    const text = out ? `$ ${block.command}\n${out}` : `$ ${block.command}`;
    useChatStore.getState().attachSelection(text, "terminal");
  };

  const handleFixWithAi = () => {
    const out = capAttachOutput(output());
    const prompt = t("terminal.block.fixCommandErrorPrompt", {
      command: block.command,
      code: String(block.exitCode ?? 1),
      output: out,
    });
    const chat = useChatStore.getState();
    if (!chat.activeSessionId) {
      chat.newSession();
    }
    chat.openPanel();
    chat.focusInput(prompt);
  };

  const handleExplainError = () => {
    const out = capAttachOutput(output());
    const prompt = t("terminal.block.explainErrorPrompt", {
      output: out ? `$ ${block.command}\n${out}` : block.command,
    });
    const chat = useChatStore.getState();
    if (!chat.activeSessionId) {
      chat.newSession();
    }
    chat.openPanel();
    chat.focusInput(prompt);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("terminal.block.blockActions")}
          className="bt-btn"
        >
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            size={14}
            strokeWidth={1.75}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          all.onRestoreFocus();
        }}
      >
        <MenuItem
          icon={Refresh01Icon}
          label={t("terminal.block.runAgain")}
          disabled={block.running || !all.promptReady || !block.command}
          onClick={() => all.onRunAgain(block.command)}
        />
        <MenuItem
          icon={Copy01Icon}
          label={t("terminal.block.copyCommand")}
          disabled={!block.command}
          onClick={() => copy(block.command, t("terminal.block.commandCopied"))}
        />
        <MenuItem
          icon={ComputerTerminal02Icon}
          label={t("terminal.block.copyOutput")}
          onClick={() => {
            const o = output();
            if (o) copy(o, t("terminal.block.outputCopied"));
          }}
        />
        <MenuItem
          icon={Copy01Icon}
          label={t("terminal.block.copyCommandAndOutput")}
          onClick={() => {
            const text = `$ ${block.command}\n${output()}`;
            copy(text, t("terminal.block.blockCopied"));
          }}
        />
        {failed && aiAvailable && (
          <MenuItem
            icon={SparklesIcon}
            label={t("terminal.block.fixWithAi")}
            onClick={handleFixWithAi}
          />
        )}
        {failed && aiAvailable && (
          <MenuItem
            icon={SparklesIcon}
            label={t("terminal.block.explainError")}
            onClick={handleExplainError}
          />
        )}
        {aiAvailable ? (
          <MenuItem
            icon={SparklesIcon}
            label={t("terminal.block.attachToAi")}
            onClick={attach}
          />
        ) : null}
        <MenuItem
          icon={Search01Icon}
          label={t("terminal.block.findInBlock")}
          onClick={() => onSearch(block.id)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Copy01Icon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onClick}
      className="gap-2 text-xs"
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
      {label}
    </DropdownMenuItem>
  );
}

function SearchBar({
  blockId,
  searchBlock,
  revealMatch,
  onClose,
}: {
  blockId: string;
  searchBlock: (id: string, query: string) => BlockMatch[];
  revealMatch: (m: BlockMatch) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<BlockMatch[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (query: string) => {
    const m = searchBlock(blockId, query);
    setMatches(m);
    setIdx(0);
    if (m.length) revealMatch(m[0]);
  };
  const nav = (dir: number) => {
    if (!matches.length) return;
    const next = (idx + dir + matches.length) % matches.length;
    setIdx(next);
    revealMatch(matches[next]);
  };

  return (
    <div className="bt-search pointer-events-auto">
      <HugeiconsIcon icon={Search01Icon} size={12} strokeWidth={1.75} />
      <input
        ref={inputRef}
        className="bt-search-input"
        placeholder={t("terminal.block.findInBlock")}
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            nav(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="bt-search-count">
        {matches.length ? `${idx + 1}/${matches.length}` : "0"}
      </span>
      <SearchBtn
        title={t("terminal.block.prev")}
        icon={ArrowUp01Icon}
        onClick={() => nav(-1)}
      />
      <SearchBtn
        title={t("terminal.block.next")}
        icon={ArrowDown01Icon}
        onClick={() => nav(1)}
      />
      <SearchBtn
        title={t("terminal.block.close")}
        icon={Cancel01Icon}
        onClick={onClose}
      />
    </div>
  );
}

function SearchBtn({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: typeof Copy01Icon;
  onClick: () => void;
}) {
  return (
    <button type="button" title={title} onClick={onClick} className="bt-btn">
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
    </button>
  );
}
