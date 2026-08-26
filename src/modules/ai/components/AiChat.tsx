import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import {
  Message,
  MessageContent,
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool } from "@/components/ai-elements/tool";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { t, useTranslation } from "@/modules/i18n";
import {
  MarkdownLink,
  type MarkdownLinkProps,
} from "@/modules/markdown/MarkdownLink";
import {
  ArrowRight01Icon,
  CodeIcon,
  File01Icon,
  HashtagIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  ChatStatus,
  DynamicToolUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "ai";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { toast } from "sonner";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
  CHAT_VIRTUAL_OVERSCAN,
  type ConversationEstimateState,
  estimateMessageHeight,
  loadConversationScroll,
  saveConversationScroll,
  shouldVirtualizeConversation,
  updateConversationEstimate,
} from "../lib/conversationPerformance";
import { SLASH_COMMANDS, VOKTTY_CMD_RE } from "../lib/slashCommands";
import { sendMessage } from "../store/chatRuntime";
import { useChatStore } from "../store/chatStore";
import { type McpApprovalPart, respondToMcpApproval } from "../tools/mcp";
import { AiToolApproval } from "./AiToolApproval";

function CommandSnippet({ name }: { name: string }) {
  const meta = SLASH_COMMANDS[name];
  if (!meta) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2 py-1 font-mono text-[11px]">
        /{name}
      </div>
    );
  }
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-border/50 bg-muted/40 px-2 py-1">
      <HugeiconsIcon
        icon={meta.icon}
        size={12}
        strokeWidth={1.75}
        className="shrink-0 text-foreground"
      />
      <span className="font-mono text-[11px] text-foreground">
        {meta.invocation}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">
        {t(meta.labelKey)}
      </span>
    </div>
  );
}

type AnyToolPart = ToolUIPart | DynamicToolUIPart;
type ApprovalResponsePart = McpApprovalPart & { approvalId: string };

type ContextChip =
  | { kind: "selection"; source: "terminal" | "editor"; lines: number }
  | { kind: "file"; name: string; lines: number }
  | { kind: "snippet"; name: string };

const SELECTION_RE =
  /<selection\s+source="(terminal|editor)">\n?([\s\S]*?)\n?<\/selection>/g;
const FILE_RE = /<file\s+name="([^"]+)"[^>]*>\n?([\s\S]*?)\n?<\/file>/g;
const SNIPPET_RE = /<snippet\s+name="([^"]+)">\n?[\s\S]*?\n?<\/snippet>/g;

function countLines(s: string): number {
  if (!s) return 0;
  const trimmed = s.replace(/\n+$/, "");
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

function stripUserContextBlocks(text: string): {
  text: string;
  chips: ContextChip[];
} {
  const chips: ContextChip[] = [];
  let out = text;
  out = out.replace(SELECTION_RE, (_m, source: string, body: string) => {
    chips.push({
      kind: "selection",
      source: source === "editor" ? "editor" : "terminal",
      lines: countLines(body),
    });
    return "";
  });
  out = out.replace(FILE_RE, (_m, name: string, body: string) => {
    chips.push({ kind: "file", name, lines: countLines(body) });
    return "";
  });
  out = out.replace(SNIPPET_RE, (_m, name: string) => {
    chips.push({ kind: "snippet", name });
    return "";
  });
  return { text: out.trim(), chips };
}

const ContextChips = memo(function ContextChips({
  chips,
}: {
  chips: ContextChip[];
}) {
  return (
    <div className="mb-1 flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-card/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
        >
          {chipIcon(c)}
          <span className="font-medium text-foreground">{chipLabel(c)}</span>
          {"lines" in c && c.lines > 0 ? (
            <span className="opacity-70">· {c.lines}L</span>
          ) : null}
        </span>
      ))}
    </div>
  );
});

function chipIcon(c: ContextChip) {
  if (c.kind === "selection") {
    return (
      <HugeiconsIcon
        icon={c.source === "editor" ? CodeIcon : TerminalIcon}
        size={10}
        strokeWidth={1.75}
      />
    );
  }
  if (c.kind === "file") {
    return <HugeiconsIcon icon={File01Icon} size={10} strokeWidth={1.75} />;
  }
  return <HugeiconsIcon icon={HashtagIcon} size={10} strokeWidth={1.75} />;
}

function chipLabel(c: ContextChip): string {
  if (c.kind === "selection") {
    return c.source === "editor"
      ? t("ai.editorSelection")
      : t("ai.terminalSelection");
  }
  if (c.kind === "file") return c.name;
  return `#${c.name}`;
}
type AnyPart = UIMessagePart<Record<string, never>, Record<string, never>>;

type ApprovalArg = {
  id: string;
  approved: boolean;
  reason?: string;
};

type Props = {
  sessionId: string;
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  clearError: () => void;
  addToolApprovalResponse: (arg: ApprovalArg) => void | PromiseLike<void>;
  stop: () => void | PromiseLike<void>;
};

export function AiChatView({
  sessionId,
  messages,
  status,
  error,
  clearError,
  addToolApprovalResponse,
}: Props) {
  const { t } = useTranslation();
  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const showSpinner = isBusy && lastMessage?.role === "user";
  const streamingMessageId =
    status === "streaming" && lastMessage?.role === "assistant"
      ? lastMessage.id
      : null;
  const step = useChatStore((s) => s.agentMeta.step);
  const hitStepCap = useChatStore((s) => s.agentMeta.hitStepCap);
  const compactionNotice = useChatStore((s) => s.agentMeta.compactionNotice);
  const patchAgentMeta = useChatStore((s) => s.patchAgentMeta);
  const showContinue =
    !isBusy && hitStepCap && lastMessage?.role === "assistant";

  const onApproval = useCallback(
    async (part: ApprovalResponsePart, approved: boolean) => {
      try {
        await respondToMcpApproval(part, approved, (resolved) =>
          addToolApprovalResponse({ id: part.approvalId, approved: resolved }),
        );
      } catch {
        toast.error(t("ai.approvals.mcpResponseFailed"));
      }
    },
    [addToolApprovalResponse, t],
  );

  if (messages.length === 0) {
    return (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            title={t("ai.emptyTitle")}
            description={t("ai.emptyDescription")}
          />
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <Conversation initial={false}>
      <ConversationContent className="gap-5 p-3">
        <ConversationMessageWindow
          sessionId={sessionId}
          messages={messages}
          onApproval={onApproval}
          streamingMessageId={streamingMessageId}
        />
        {compactionNotice && (
          <CompactionNotice
            droppedCount={compactionNotice.droppedCount}
            onDismiss={() => patchAgentMeta({ compactionNotice: null })}
          />
        )}
        {showSpinner && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            <span className="truncate">{step ?? t("ai.thinking")}</span>
          </div>
        )}
        {showContinue && (
          <ContinueRow
            onContinue={() => {
              patchAgentMeta({ hitStepCap: false });
              void sendMessage(
                "Continue from where you stopped. Don't recap — just keep going.",
              );
            }}
          />
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <div className="font-medium">{t("ai.requestFailed")}</div>
            <div className="mt-0.5 leading-relaxed opacity-90">
              {error.message}
            </div>
            <button
              type="button"
              onClick={clearError}
              className="mt-1 underline opacity-80 hover:opacity-100"
            >
              {t("ai.dismiss")}
            </button>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function useConversationEstimate(
  sessionId: string,
  messages: readonly UIMessage[],
): ConversationEstimateState {
  const estimateRef = useRef<ConversationEstimateState | null>(null);
  return useMemo(() => {
    const next = updateConversationEstimate(
      estimateRef.current,
      sessionId,
      messages,
    );
    estimateRef.current = next;
    return next;
  }, [messages, sessionId]);
}

function useConversationScrollRestoration(sessionId: string): void {
  const { isAtBottom, scrollRef, scrollToBottom } = useStickToBottomContext();
  const atBottomRef = useRef(isAtBottom);
  useEffect(() => {
    atBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const saved = loadConversationScroll(sessionId);
    const restore = () => {
      if (saved && !saved.atBottom) {
        scrollElement.scrollTop = saved.scrollTop;
      } else {
        scrollElement.scrollTop = scrollElement.scrollHeight;
        void scrollToBottom("instant");
      }
    };
    restore();
    const frame = window.requestAnimationFrame(restore);
    return () => {
      window.cancelAnimationFrame(frame);
      saveConversationScroll(sessionId, {
        scrollTop: scrollElement.scrollTop,
        atBottom: atBottomRef.current,
      });
    };
  }, [scrollRef, scrollToBottom, sessionId]);
}

const ConversationMessageWindow = memo(function ConversationMessageWindow({
  sessionId,
  messages,
  onApproval,
  streamingMessageId,
}: {
  sessionId: string;
  messages: UIMessage[];
  onApproval: (part: ApprovalResponsePart, approved: boolean) => void;
  streamingMessageId: string | null;
}) {
  const { scrollRef } = useStickToBottomContext();
  const estimate = useConversationEstimate(sessionId, messages);
  const windowed = shouldVirtualizeConversation(
    messages.length,
    estimate.totalChars,
  );
  useConversationScrollRestoration(sessionId);
  const virtualizer = useVirtualizer({
    count: windowed ? messages.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const message = messages[index];
      if (!message) return 120;
      return estimateMessageHeight(message, estimate.chars[index] ?? 0) + 20;
    },
    getItemKey: (index) => messages[index]?.id ?? index,
    overscan: CHAT_VIRTUAL_OVERSCAN,
  });

  if (!windowed) {
    return messages.map((message) => (
      <RenderedMessage
        key={message.id}
        message={message}
        onApproval={onApproval}
        streaming={message.id === streamingMessageId}
      />
    ));
  }

  return (
    <div
      data-ai-message-window
      data-message-count={messages.length}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualMessage) => {
        const message = messages[virtualMessage.index];
        if (!message) return null;
        return (
          <article
            key={virtualMessage.key}
            ref={virtualizer.measureElement}
            data-index={virtualMessage.index}
            data-ai-message-index={virtualMessage.index}
            aria-posinset={virtualMessage.index + 1}
            aria-setsize={messages.length}
            className="absolute left-0 top-0 w-full pb-5"
            style={{ transform: `translateY(${virtualMessage.start}px)` }}
          >
            <RenderedMessage
              message={message}
              onApproval={onApproval}
              streaming={message.id === streamingMessageId}
            />
          </article>
        );
      })}
    </div>
  );
});

const CompactionNotice = memo(function CompactionNotice({
  droppedCount,
  onDismiss,
}: {
  droppedCount: number;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <span className="size-1.5 shrink-0 rounded-full bg-amber-500/80" />
      <span className="flex-1 truncate">
        {t("ai.compactionNotice", { count: String(droppedCount) })}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[10.5px] underline opacity-70 hover:opacity-100"
      >
        {t("ai.dismiss")}
      </button>
    </div>
  );
});

const ContinueRow = memo(function ContinueRow({
  onContinue,
}: {
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card/60 px-2.5 py-1.5 text-[11px]">
      <span className="flex-1 text-muted-foreground">
        {t("ai.stepLimitHit")}
      </span>
      <button
        type="button"
        onClick={onContinue}
        className="rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        {t("ai.continueLabel")}
      </button>
    </div>
  );
});

const RenderedMessage = memo(function RenderedMessage({
  message,
  onApproval,
  streaming,
}: {
  message: UIMessage;
  onApproval: (part: ApprovalResponsePart, approved: boolean) => void;
  streaming: boolean;
}) {
  // Index of the trailing text part — only that one is "live" mid-stream.
  // Earlier text parts (separated by tool calls) are already finalized.
  let lastTextIdx = -1;
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    if (message.parts[i]?.type === "text") {
      lastTextIdx = i;
      break;
    }
  }
  const groups = useMemo(
    () => buildPartGroups(message.parts as AnyPart[]),
    [message.parts],
  );

  if (message.role === "user") {
    const rawText = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");

    const cmdMatch = rawText.match(VOKTTY_CMD_RE);
    const commandName = cmdMatch?.[1] ?? null;
    const withoutCmd = cmdMatch ? rawText.slice(cmdMatch[0].length) : rawText;
    const stripped = stripUserContextBlocks(withoutCmd);

    return (
      <div className="[content-visibility:auto] [contain-intrinsic-size:auto_60px]">
        <Message from="user">
          <MessageContent>
            {commandName ? <CommandSnippet name={commandName} /> : null}
            {stripped.chips.length > 0 ? (
              <ContextChips chips={stripped.chips} />
            ) : null}
            {stripped.text ? (
              <p className="whitespace-pre-wrap wrap-break-word">
                {stripped.text}
              </p>
            ) : null}
          </MessageContent>
        </Message>
      </div>
    );
  }

  return (
    <div
      className={
        streaming
          ? undefined
          : "[content-visibility:auto] [contain-intrinsic-size:auto_120px]"
      }
    >
      <Message from={message.role}>
        <MessageContent>
          <div className="flex flex-col gap-3">
            {groups.map((g) => {
              if (g.kind === "reads") {
                return (
                  <PartAppear
                    key={`${message.id}-${g.key}`}
                    animate={streaming}
                  >
                    <ReadGroup parts={g.parts} />
                  </PartAppear>
                );
              }
              const isReadSingle =
                partType(g.part) === "tool-read_file" &&
                ((g.part as { state?: string }).state ?? "") !==
                  "approval-requested";
              if (isReadSingle) {
                return (
                  <PartAppear
                    key={`${message.id}-${g.key}`}
                    animate={streaming}
                  >
                    <ReadRow part={g.part} />
                  </PartAppear>
                );
              }
              return (
                <PartAppear key={`${message.id}-${g.key}`} animate={streaming}>
                  <RenderedPart
                    part={g.part}
                    onApproval={onApproval}
                    streaming={streaming && g.idx === lastTextIdx}
                  />
                </PartAppear>
              );
            })}
          </div>
        </MessageContent>
      </Message>
    </div>
  );
});

type Group =
  | { kind: "single"; part: AnyPart; idx: number; key: string }
  | { kind: "reads"; parts: AnyPart[]; key: string };

function partType(p: AnyPart): string {
  return (p as { type?: string }).type ?? "";
}

function isReadFilePart(p: AnyPart): boolean {
  if (partType(p) !== "tool-read_file") return false;
  const state = (p as { state?: string }).state ?? "";
  return state !== "approval-requested";
}

function partKey(p: AnyPart, idx: number): string {
  const tc = (p as { toolCallId?: string }).toolCallId;
  if (tc) return tc;
  const id = (p as { approval?: { id?: string } }).approval?.id;
  if (id) return id;
  return `i-${idx}`;
}

function buildPartGroups(parts: AnyPart[]): Group[] {
  const out: Group[] = [];
  let run: { parts: AnyPart[]; startIdx: number } | null = null;
  const flushRun = () => {
    if (!run) return;
    if (run.parts.length >= 2) {
      out.push({
        kind: "reads",
        parts: run.parts,
        key: `reads-${partKey(run.parts[0], run.startIdx)}`,
      });
    } else {
      run.parts.forEach((p, k) => {
        const idx = run!.startIdx + k;
        out.push({ kind: "single", part: p, idx, key: partKey(p, idx) });
      });
    }
    run = null;
  };
  parts.forEach((p, i) => {
    if (isReadFilePart(p)) {
      if (!run) run = { parts: [], startIdx: i };
      run.parts.push(p);
      return;
    }
    flushRun();
    out.push({ kind: "single", part: p, idx: i, key: partKey(p, i) });
  });
  flushRun();
  return out;
}

function readPathFromPart(p: AnyPart): string | null {
  const input = (p as { input?: { path?: unknown } }).input;
  const path = input?.path;
  return typeof path === "string" && path.length > 0 ? path : null;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

const ReadGroup = memo(function ReadGroup({ parts }: { parts: AnyPart[] }) {
  const { t } = useTranslation();
  const paths = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
      const path = readPathFromPart(p);
      if (!path) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
    return out;
  }, [parts]);
  const count = paths.length || parts.length;
  const preview = paths.map(basename).join(", ");

  return (
    <Collapsible className="group/read overflow-hidden rounded-md border border-border/50 bg-card/50">
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
          "transition-colors hover:bg-muted/50",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={11}
          strokeWidth={2}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            "group-data-[state=open]/read:rotate-90",
          )}
        />
        <HugeiconsIcon
          icon={File01Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 font-medium text-foreground">
          {t("ai.readLabel")}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t("ai.fileCount", { count: String(count) })}
        </span>
        {paths.length > 0 ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/80 group-data-[state=open]/read:invisible">
            · {preview}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="voktty-collapsible-content border-t border-border/30">
        <ul className="flex flex-col gap-0.5 px-2 py-1.5">
          {paths.map((path) => (
            <li
              key={path}
              className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
            >
              <HugeiconsIcon
                icon={File01Icon}
                size={10}
                strokeWidth={1.75}
                className="shrink-0 opacity-60"
              />
              <span className="truncate text-foreground">{basename(path)}</span>
              <span className="truncate opacity-60">{path}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
});

const PartAppear = memo(function PartAppear({
  children,
  animate,
}: {
  children: React.ReactNode;
  animate: boolean;
}) {
  return (
    <div
      className={
        animate
          ? "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out"
          : undefined
      }
    >
      {children}
    </div>
  );
});

const ReadRow = memo(function ReadRow({ part }: { part: AnyPart }) {
  const { t } = useTranslation();
  const path = readPathFromPart(part);
  const state = (part as { state?: string }).state ?? "";
  const isError = state === "output-error";
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isError
            ? "bg-destructive"
            : "border border-muted-foreground/40 bg-transparent",
        )}
      />
      <HugeiconsIcon
        icon={File01Icon}
        size={13}
        strokeWidth={1.75}
        className="shrink-0 text-muted-foreground"
      />
      <span className="shrink-0 font-medium text-foreground">
        {t("ai.readLabel")}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {path ?? ""}
      </span>
    </div>
  );
});

const aiStreamdownComponents = {
  a: (props: MarkdownLinkProps) => (
    <MarkdownLink {...props} onSettled={useChatStore.getState().focusInput} />
  ),
  code: MarkdownCode,
};

function AiMessageResponse(props: Omit<MessageResponseProps, "components">) {
  return <MessageResponse {...props} components={aiStreamdownComponents} />;
}

const RenderedPart = memo(function RenderedPart({
  part,
  onApproval,
  streaming,
}: {
  part: AnyPart;
  onApproval: (part: ApprovalResponsePart, approved: boolean) => void;
  streaming: boolean;
}) {
  if (part.type === "text") {
    return (
      <AiMessageResponse streaming={streaming}>
        {(part as unknown as { text: string }).text}
      </AiMessageResponse>
    );
  }

  if (part.type === "reasoning") {
    return (
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>
          {(part as unknown as { text: string }).text}
        </ReasoningContent>
      </Reasoning>
    );
  }

  if (
    part.type === "dynamic-tool" ||
    (typeof part.type === "string" && part.type.startsWith("tool-"))
  ) {
    return (
      <RenderedTool
        part={part as unknown as AnyToolPart}
        onApproval={onApproval}
      />
    );
  }

  return null;
});

const RenderedTool = memo(function RenderedTool({
  part,
  onApproval,
}: {
  part: AnyToolPart;
  onApproval: (part: ApprovalResponsePart, approved: boolean) => void;
}) {
  const toolName =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type.replace(/^tool-/, "");

  if (part.state === "approval-requested") {
    return (
      <AiToolApproval
        part={part as Extract<ToolUIPart, { state: "approval-requested" }>}
        toolName={toolName}
        onRespond={(approved) =>
          onApproval(
            {
              approvalId: part.approval.id,
              toolName,
              toolCallId: part.toolCallId,
              toolMetadata: part.toolMetadata,
            },
            approved,
          )
        }
      />
    );
  }

  return (
    <Tool
      toolName={toolName}
      state={part.state}
      input={part.input}
      output={"output" in part ? part.output : undefined}
      errorText={"errorText" in part ? part.errorText : undefined}
      defaultOpen={toolName === "list_directory"}
    />
  );
});
