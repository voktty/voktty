import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/modules/i18n";
import type { AliasDefinition, AliasTarget, BuiltinAction, ResolvedAlias } from "../types";
import { useAliasStore } from "../store/aliasStore";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AliasDialogProps {
  open: boolean;
  alias: ResolvedAlias | null; // null = create new
  onClose: () => void;
}

type TargetKind = "command" | "builtin";

const BUILTIN_ACTIONS: BuiltinAction[] = [
  "ipme",
  "port",
  "sslcheck",
  "jwt",
  "envdiff",
  "hash",
  "sysinfo",
  "bench",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function AliasDialog({ open, alias, onClose }: AliasDialogProps) {
  const { t } = useTranslation();
  const { saveAlias } = useAliasStore();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [targetKind, setTargetKind] = useState<TargetKind>("command");
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("");
  const [action, setAction] = useState<BuiltinAction>("ipme");
  const [isSaving, setIsSaving] = useState(false);

  // ── Populate from alias ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (alias) {
      setName(alias.name);
      setDescription(alias.definition.description);
      setEnabled(alias.definition.enabled);
      const target = alias.definition.target;
      if (target.kind === "builtin") {
        setTargetKind("builtin");
        setAction(target.action);
        setExecutable("");
        setArgs("");
      } else {
        setTargetKind("command");
        setExecutable(target.executable);
        setArgs(target.args.join(" "));
        setAction("ipme");
      }
    } else {
      setName("");
      setDescription("");
      setEnabled(true);
      setTargetKind("command");
      setExecutable("");
      setArgs("");
      setAction("ipme");
    }
  }, [open, alias]);

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!name.trim()) {
      toast.error(t("aliases.dialog.nameRequired"));
      return;
    }

    const target: AliasTarget =
      targetKind === "builtin"
        ? { kind: "builtin", action }
        : {
            kind: "command",
            executable: executable.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : [],
          };

    const definition: AliasDefinition = {
      description: description.trim(),
      enabled,
      disabledWorkspaces: alias?.definition.disabledWorkspaces ?? [],
      disabledProfiles: alias?.definition.disabledProfiles ?? [],
      target,
    };

    setIsSaving(true);
    try {
      await saveAlias(name.trim(), definition);
      toast.success(t("aliases.dialog.saved"));
      onClose();
    } catch {
      toast.error(t("aliases.dialog.saveError"));
    } finally {
      setIsSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[13px]">
            {alias ? t("aliases.dialog.editTitle") : t("aliases.dialog.newTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {t("aliases.dialog.name")}
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("aliases.dialog.namePlaceholder")}
              disabled={!!alias}
              className="h-8 text-[12px] font-mono"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {t("aliases.dialog.description")}
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("aliases.dialog.descriptionPlaceholder")}
              className="h-8 text-[12px]"
            />
          </div>

          {/* Target kind */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {t("aliases.dialog.targetKind")}
            </Label>
            <Select
              value={targetKind}
              onValueChange={(v) => setTargetKind(v as TargetKind)}
            >
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="command" className="text-[12px]">
                  {t("aliases.dialog.command")}
                </SelectItem>
                <SelectItem value="builtin" className="text-[12px]">
                  {t("aliases.dialog.builtin")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Command fields */}
          {targetKind === "command" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  {t("aliases.dialog.executable")}
                </Label>
                <Input
                  value={executable}
                  onChange={(e) => setExecutable(e.target.value)}
                  placeholder={t("aliases.dialog.executablePlaceholder")}
                  className="h-8 text-[12px] font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  {t("aliases.dialog.args")}
                </Label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder={t("aliases.dialog.argsPlaceholder")}
                  className="h-8 text-[12px] font-mono"
                />
              </div>
            </>
          )}

          {/* Builtin action */}
          {targetKind === "builtin" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                {t("aliases.dialog.builtinAction")}
              </Label>
              <Select
                value={action}
                onValueChange={(v) => setAction(v as BuiltinAction)}
              >
                <SelectTrigger className="h-8 text-[12px] font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUILTIN_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a} className="text-[12px] font-mono">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3.5 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-medium">{t("aliases.dialog.enabled")}</span>
              <span className="text-[10.5px] text-muted-foreground">
                {t("aliases.dialog.enabledHint")}
              </span>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-[12px]" onClick={onClose}>
            {t("dialog.cancel")}
          </Button>
          <Button
            size="sm"
            className="text-[12px]"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? t("dialog.saving") : t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
