import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  Cancel01Icon,
  Edit02Icon,
  FileEditIcon,
  FilePlusIcon,
  FolderAddIcon,
  TerminalIcon,
  Tick02Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ToolUIPart } from "ai";
import { memo } from "react";

type Props = {
  part: Extract<ToolUIPart, { state: "approval-requested" }>;
  toolName: string;
  onRespond: (approved: boolean) => void;
};

const TOOL_META: Record<string, { icon: typeof FilePlusIcon }> = {
  write_file: { icon: FilePlusIcon },
  edit: { icon: FileEditIcon },
  multi_edit: { icon: Edit02Icon },
  create_directory: { icon: FolderAddIcon },
  bash_run: { icon: TerminalIcon },
  bash_background: { icon: TerminalIcon },
  run_development_check: { icon: TerminalIcon },
};

function AiToolApprovalImpl({ part, toolName, onRespond }: Props) {
  const { t } = useTranslation();
  const meta = TOOL_META[toolName];
  const toolMetadata = (part as typeof part & { toolMetadata?: unknown }).toolMetadata;
  const mcpDisplayName =
    toolMetadata && typeof toolMetadata === "object"
      ? (toolMetadata as Record<string, unknown>).displayName
      : null;
  const mcpMetadata =
    toolMetadata && typeof toolMetadata === "object"
      ? (toolMetadata as Record<string, unknown>)
      : null;
  const label =
    typeof mcpDisplayName === "string"
      ? mcpDisplayName
      : toolName === "write_file"
      ? t("ai.approvals.writeFile")
      : toolName === "edit"
        ? t("ai.approvals.editFile")
        : toolName === "multi_edit"
          ? t("ai.approvals.editBatch")
          : toolName === "create_directory"
            ? t("ai.approvals.createDir")
            : toolName === "bash_run"
              ? t("ai.approvals.runShell")
              : toolName === "bash_background"
                ? t("ai.approvals.spawnBackground")
                : toolName === "run_development_check"
                  ? t("ai.approvals.runDevelopmentCheck")
                  : toolName;
  const Icon = meta?.icon ?? ToolsIcon;
  const input = part.input as Record<string, unknown>;

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="size-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />
        <HugeiconsIcon
          icon={Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="text-[12px] font-medium text-foreground">
          {label}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {t("ai.approvals.needsApproval")}
        </span>
      </div>

      <div className="px-3 py-2.5">
        {mcpMetadata?.origin === "mcp" ? (
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9.5px] text-muted-foreground">
            <span>{String(mcpMetadata.serverId ?? "MCP")}</span>
            <span>{String(mcpMetadata.scope ?? "")}</span>
            {Array.isArray(mcpMetadata.effects) ? (
              <span>
                {mcpMetadata.effects
                  .map((effect) => t(`settings.mcp.effects.${String(effect)}`))
                  .join(", ")}
              </span>
            ) : null}
          </div>
        ) : null}
        <PreviewBlock toolName={toolName} input={input} />
      </div>

      <div className="flex items-center justify-end gap-1.5 border-t border-border/60 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRespond(false)}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          {t("ai.approvals.deny")}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => onRespond(true)}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
          {t("ai.approvals.allow")}
        </Button>
      </div>
    </div>
  );
}


export const AiToolApproval = memo(AiToolApprovalImpl, (a, b) => {
  // The approval card never changes content for a given approvalId — once
  // the model has emitted the approval-requested part with its input, we
  // don't want to re-render on every downstream token.
  return (
    a.toolName === b.toolName &&
    a.part.approval.id === b.part.approval.id &&
    a.onRespond === b.onRespond
  );
});

function PreviewBlock({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  if (
    toolName === "bash_run" ||
    toolName === "bash_background" ||
    toolName === "run_development_check"
  ) {
    const cwd = typeof input.cwd === "string" ? input.cwd : null;
    return (
      <div className="space-y-1.5">
        {cwd && (
          <div className="font-mono text-[10.5px] text-muted-foreground">
            {cwd}
          </div>
        )}
        <pre
          className={cn(
            "max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed",
          )}
        >
          {String(input.command ?? "")}
        </pre>
      </div>
    );
  }
  // For file mutations we deliberately do NOT preview content here —
  // streamed write/edit content thrashes the UI and the AI diff tab is the
  // authoritative place to review the change. Show just the path + a
  // one-line size hint so the user knows what's being touched.
  if (toolName === "write_file") {
    const content = typeof input.content === "string" ? input.content : "";
    const lines = content ? content.split("\n").length : 0;
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-muted-foreground">{String(input.path ?? "")}</div>
        <div className="text-[10.5px] text-muted-foreground/80">
          {t("ai.approvals.linesReview", { lines })}
        </div>
      </div>
    );
  }
  if (toolName === "edit") {
    const oldStr = typeof input.old_string === "string" ? input.old_string : "";
    const newStr = typeof input.new_string === "string" ? input.new_string : "";
    const removed = oldStr ? oldStr.split("\n").length : 0;
    const added = newStr ? newStr.split("\n").length : 0;
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-muted-foreground">
          {String(input.path ?? "")}
          {input.replace_all ? ` ${t("ai.approvals.replaceAll")}` : ""}
        </div>
        <div className="text-[10.5px] text-muted-foreground/80">
          {t("ai.approvals.diffStatsReview", { removed, added })}
        </div>
      </div>
    );
  }
  if (toolName === "multi_edit") {
    const edits = Array.isArray(input.edits)
      ? (input.edits as Array<{ old_string?: string; new_string?: string }>)
      : [];
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-muted-foreground">{String(input.path ?? "")}</div>
        <div className="text-[10.5px] text-muted-foreground/80">
          {t("ai.approvals.editsReview", { count: edits.length })}
        </div>
      </div>
    );
  }
  if (toolName === "create_directory") {
    return (
      <div className="font-mono text-[11px] text-muted-foreground">
        {String(input.path ?? "")}
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
      {JSON.stringify(summarizeInput(input, t("ai.approvals.sensitiveValue")), null, 2)}
    </pre>
  );
}

function summarizeInput(
  input: Record<string, unknown>,
  sensitiveValue: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).slice(0, 20).map(([key, value]) => {
      if (/token|secret|password|credential|api.?key/i.test(key)) {
        return [key, sensitiveValue];
      }
      if (typeof value === "string") {
        return [key, value.length > 120 ? `${value.slice(0, 119)}…` : value];
      }
      if (Array.isArray(value)) return [key, `[${value.length}]`];
      if (value && typeof value === "object") return [key, "{…}"];
      return [key, value];
    }),
  );
}
