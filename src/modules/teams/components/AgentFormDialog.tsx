import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/modules/i18n";
import type { AgentDefinition } from "@/modules/workspace-kit/lib/configTypes";
import { saveAgent } from "../lib/rosterEditor";

const ADAPTER_OPTIONS = [
  "claude-code",
  "claude",
  "codex",
  "antigravity",
  "opencode",
  "gemini",
  "cursor",
  "grok",
  "pi",
  "hermes",
  "generic",
  "codestral",
  "groq",
  "ollama",
  "openai",
  "openrouter",
  "perplexity",
  "together",
] as const;

const EFFORT_OPTIONS = ["", "low", "medium", "high", "xhigh", "max"] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  initialAgent?: AgentDefinition | null;
  onSaved: () => void;
};

export function AgentFormDialog({
  open,
  onOpenChange,
  projectPath,
  initialAgent,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState<"on-demand" | "always">("on-demand");
  const [adapter, setAdapter] = useState<string>("claude-code");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<string>("");
  const [command, setCommand] = useState("");
  const [owns, setOwns] = useState("");
  const [reads, setReads] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialAgent) {
      setName(initialAgent.name);
      setRole(initialAgent.role);
      setDescription(initialAgent.description ?? "");
      setStart(initialAgent.start ?? "on-demand");
      setAdapter(initialAgent.runtime?.adapter ?? "claude-code");
      setModel(initialAgent.runtime?.model ?? "");
      setEffort(initialAgent.runtime?.effort ?? "");
      setCommand(initialAgent.runtime?.command ?? "");
      setOwns((initialAgent.owns ?? []).join("\n"));
      setReads((initialAgent.reads ?? []).join("\n"));
    } else {
      setName("");
      setRole("roles/developer.md");
      setDescription("");
      setStart("on-demand");
      setAdapter("claude-code");
      setModel("claude-3-7-sonnet");
      setEffort("");
      setCommand("");
      setOwns("");
      setReads("");
    }
    setError(null);
  }, [initialAgent, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const parsedOwns = owns
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const parsedReads = reads
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const agentDef: AgentDefinition = {
        name: name.trim(),
        role: role.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        start,
        runtime: {
          adapter,
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(effort ? { effort: effort as any } : {}),
          ...(adapter === "generic" && command.trim()
            ? { command: command.trim() }
            : {}),
        },
        ...(parsedOwns.length > 0 ? { owns: parsedOwns } : {}),
        ...(parsedReads.length > 0 ? { reads: parsedReads } : {}),
      };

      const result = await saveAgent(projectPath, agentDef);
      if (!result.ok) {
        setError(result.error ?? "Failed to save agent");
      } else {
        onSaved();
        onOpenChange(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {initialAgent ? t("teams.editAgent") : t("teams.addAgent")}
          </DialogTitle>
          <DialogDescription>
            {initialAgent ? initialAgent.name : t("teams.agentName")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2 text-sm">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-2">
            <label htmlFor="agent-name" className="font-medium">
              {t("teams.agentName")}
            </label>
            <Input
              id="agent-name"
              disabled={Boolean(initialAgent) || saving}
              value={name}
              onChange={(e) => {
                const val = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
                setName(val);
                if (!initialAgent && (!role || role.startsWith("roles/"))) {
                  setRole(`roles/${val || "agent"}.md`);
                }
              }}
              placeholder={t("teams.namePlaceholder")}
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="agent-role" className="font-medium">
              {t("teams.rolePath")}
            </label>
            <Input
              id="agent-role"
              disabled={saving}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t("teams.rolePlaceholder")}
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="agent-desc" className="font-medium">
              {t("teams.description")}
            </label>
            <Input
              id="agent-desc"
              disabled={saving}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("teams.descPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <label htmlFor="agent-adapter" className="font-medium">
                {t("teams.adapterLabel")}
              </label>
              <Select
                value={adapter}
                onValueChange={(val) => setAdapter(val)}
                disabled={saving}
              >
                <SelectTrigger id="agent-adapter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADAPTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label htmlFor="agent-start" className="font-medium">
                {t("teams.startMode")}
              </label>
              <Select
                value={start}
                onValueChange={(val: "on-demand" | "always") =>
                  setStart(val)
                }
                disabled={saving}
              >
                <SelectTrigger id="agent-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on-demand">{t("teams.startOnDemand")}</SelectItem>
                  <SelectItem value="always">{t("teams.startAlways")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label htmlFor="agent-model" className="font-medium">
                {t("teams.modelLabel")}
              </label>
              <Input
                id="agent-model"
                disabled={saving}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t("teams.modelPlaceholder")}
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="agent-effort" className="font-medium">
                {t("harness.modelSettings.reasoning")}
              </label>
              <Select
                value={effort || "none"}
                onValueChange={(val) => setEffort(val === "none" ? "" : val)}
              >
                <SelectTrigger id="agent-effort">
                  <SelectValue placeholder={t("common.default")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("common.default")}</SelectItem>
                  {EFFORT_OPTIONS.filter(Boolean).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {adapter === "generic" && (
            <div className="grid gap-2">
              <label htmlFor="agent-command" className="font-medium">
                {t("teams.commandLabel")}
              </label>
              <Input
                id="agent-command"
                disabled={saving}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t("teams.commandPlaceholder")}
                required
              />
            </div>
          )}

          <div className="grid gap-2">
            <label htmlFor="agent-owns" className="font-medium">
              {t("teams.ownsLabel")}
            </label>
            <textarea
              id="agent-owns"
              disabled={saving}
              value={owns}
              onChange={(e) => setOwns(e.target.value)}
              placeholder={t("teams.ownsPlaceholder")}
              className="min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="agent-reads" className="font-medium">
              {t("teams.readsLabel")}
            </label>
            <textarea
              id="agent-reads"
              disabled={saving}
              value={reads}
              onChange={(e) => setReads(e.target.value)}
              placeholder={t("teams.readsPlaceholder")}
              className="min-h-[50px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("teams.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "..." : t("teams.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
