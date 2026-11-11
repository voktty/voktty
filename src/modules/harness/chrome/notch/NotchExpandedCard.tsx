import { useState, type FormEvent } from "react";
import { ProjectMascot } from "@/modules/harness/chrome/ProjectMascot";
import { projectName } from "@/modules/harness/lib/paths";
import type { Session, ToolPreviewLine } from "@/modules/harness/lib/session";
import { resolveTabGroupColor } from "@/modules/harness/lib/tabGroups";
import { useTranslation } from "@/modules/i18n";

interface NotchExpandedCardProps {
  session: Session;
  onClose: () => void;
  onOpenProject: (cwd: string) => void;
  onApproval?: (sessionId: string, approvalId: number, decision: "allow" | "deny") => void;
  onSubmit?: (sessionId: string, text: string) => void;
}

export function NotchExpandedCard({
  session,
  onClose,
  onOpenProject,
  onApproval,
  onSubmit,
}: NotchExpandedCardProps) {
  const { t } = useTranslation();
  const [quickInput, setQuickInput] = useState("");

  const projectTitle = projectName(session.cwd);
  const color = resolveTabGroupColor(session.cwd);

  // Find approval block or last tool block or last assistant output
  const pendingApprovalBlock = session.blocks.find(
    (b) => b.approval && !b.approval.decided,
  );
  const lastToolBlock = [...session.blocks].reverse().find((b) => b.tool);
  const lastAssistantBlock = [...session.blocks].reverse().find((b) => b.role === "assistant");

  const preview = pendingApprovalBlock?.tool?.preview ?? lastToolBlock?.tool?.preview;
  const toolTitle = pendingApprovalBlock?.tool?.title ||
    pendingApprovalBlock?.tool?.detail ||
    lastToolBlock?.tool?.title ||
    session.harness;
  const approvalCommand =
    pendingApprovalBlock?.tool?.detail ||
    pendingApprovalBlock?.tool?.title ||
    pendingApprovalBlock?.text;

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = quickInput.trim();
    if (!trimmed || !onSubmit) return;
    onSubmit(session.id, trimmed);
    setQuickInput("");
  };

  return (
    <div className="flex flex-col w-[480px] max-w-[90vw] max-h-[460px] bg-black text-foreground rounded-2xl border border-white/10 overflow-hidden text-xs select-none animate-in fade-in zoom-in-95 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => onOpenProject(session.cwd)}
            className="group flex items-center gap-2 focus:outline-none"
            title={t("harness.notch.resumeProject", { name: projectTitle })}
          >
            <ProjectMascot
              project={session.cwd}
              active={Boolean(session.busy)}
              color={color}
              className="size-4.5 drop-shadow-sm group-hover:scale-110 transition-transform"
            />
            <span className="font-semibold text-sm text-content truncate max-w-[150px]">
              {projectTitle}
            </span>
          </button>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/10 text-content/80">
            {session.harness}
          </span>
          {session.model && (
            <span className="text-[10px] text-content/50 truncate max-w-[100px]">
              {session.model}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenProject(session.cwd)}
            className="px-2 py-1 rounded text-[11px] font-medium bg-white/10 hover:bg-white/15 text-content transition-colors"
          >
            {t("harness.notch.openInHarness")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-content/60 hover:text-content hover:bg-white/10 transition-colors"
            title={t("harness.notch.close")}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Body: Code summary / Diff / Command output */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-[140px] max-h-[280px] font-mono text-[11px]">
        {/* Title or command indicator */}
        <div className="flex items-center justify-between text-content/80">
          <span className="font-sans font-medium text-xs truncate">
            {pendingApprovalBlock ? t("harness.notch.waitingForApproval") : toolTitle}
          </span>
          {preview?.path ? (
            <span className="text-content/50 truncate max-w-[200px]" title={preview.path}>
              {preview.path}
            </span>
          ) : toolTitle && pendingApprovalBlock ? (
            <span className="text-content/50 truncate max-w-[200px] font-mono text-[10px]">
              {toolTitle}
            </span>
          ) : null}
        </div>

        {/* Diff lines if available */}
        {preview?.lines && preview.lines.length > 0 ? (
          <div className="rounded-lg bg-black/60 border border-white/5 p-2 overflow-x-auto space-y-0.5">
            {preview.lines.slice(0, 35).map((line: ToolPreviewLine, idx: number) => {
              const isAdd = line.kind === "add";
              const isDel = line.kind === "del";
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-2 px-1 rounded-sm ${
                    isAdd
                      ? "bg-emerald-500/15 text-emerald-300"
                      : isDel
                        ? "bg-rose-500/15 text-rose-300"
                        : "text-content/60"
                  }`}
                >
                  <span className="w-4 select-none opacity-50 shrink-0 text-right">
                    {line.number ?? (isAdd ? "+" : isDel ? "-" : " ")}
                  </span>
                  <span className="select-none font-bold shrink-0">
                    {isAdd ? "+" : isDel ? "-" : " "}
                  </span>
                  <span className="whitespace-pre break-all">{line.text}</span>
                </div>
              );
            })}
          </div>
        ) : preview?.output ? (
          <div className="rounded-lg bg-black/60 border border-white/5 p-2.5 overflow-x-auto text-content/75 max-h-[180px] whitespace-pre-wrap">
            {preview.output}
          </div>
        ) : approvalCommand ? (
          <div className="rounded-lg bg-black/60 border border-white/5 p-2.5 overflow-x-auto text-amber-200/90 whitespace-pre-wrap">
            $ {approvalCommand}
          </div>
        ) : lastAssistantBlock?.text ? (
          <div className="rounded-lg bg-black/60 border border-white/5 p-2.5 overflow-y-auto text-content/80 font-sans max-h-[160px] whitespace-pre-wrap leading-relaxed">
            {lastAssistantBlock.text}
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-content/40 font-sans">
            {t("harness.notch.runningTask")}...
          </div>
        )}

        {/* Pending Approval Action Buttons */}
        {pendingApprovalBlock?.approval && onApproval && (
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/10">
            <button
              type="button"
              onClick={() => onApproval(session.id, pendingApprovalBlock.approval!.requestId, "deny")}
              className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-sans font-medium transition-colors"
            >
              {t("harness.notch.deny")}
            </button>
            <button
              type="button"
              onClick={() => onApproval(session.id, pendingApprovalBlock.approval!.requestId, "allow")}
              className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-sans font-medium shadow-md transition-colors"
            >
              {t("harness.notch.allow")}
            </button>
          </div>
        )}
      </div>

      {/* Quick Input Bar to steer the agent */}
      {onSubmit && (
        <form onSubmit={handleSend} className="flex items-center gap-1.5 px-3 py-2 border-t border-white/10 bg-white/[0.02]">
          <input
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder={t("harness.notch.instructAgent")}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-content placeholder:text-content/40 focus:outline-none focus:border-white/30"
          />
          <button
            type="submit"
            disabled={!quickInput.trim()}
            className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 text-content font-medium transition-colors"
          >
            {t("harness.notch.send")}
          </button>
        </form>
      )}
    </div>
  );
}
