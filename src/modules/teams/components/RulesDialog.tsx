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
import { useTranslation } from "@/modules/i18n";
import { readRules, saveRules } from "../lib/rosterEditor";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
};

export function RulesDialog({ open, onOpenChange, projectPath }: Props) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMessage(null);
    readRules(projectPath)
      .then((rules) => {
        setContent(rules ?? "# Project Rules\n\n- Write clear, tested code.\n");
      })
      .catch(() => {
        setContent("# Project Rules\n\n- Write clear, tested code.\n");
      })
      .finally(() => setLoading(false));
  }, [open, projectPath]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveRules(projectPath, content);
      setMessage(t("teams.rulesSaved"));
      setTimeout(() => {
        onOpenChange(false);
      }, 800);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-[650px]">
        <DialogHeader>
          <DialogTitle>{t("teams.rulesTitle")}</DialogTitle>
          <DialogDescription>
            {projectPath}
          </DialogDescription>
        </DialogHeader>

        {message && (
          <div className="rounded-md border border-primary/40 bg-primary/10 p-2.5 text-xs text-primary">
            {message}
          </div>
        )}

        <div className="py-2">
          <textarea
            value={content}
            disabled={loading || saving}
            onChange={(e) => setContent(e.target.value)}
            className="h-80 w-full rounded-md border border-input bg-background p-3 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t("teams.rulesPlaceholder")}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t("teams.cancel")}
          </Button>
          <Button type="button" disabled={loading || saving} onClick={handleSave}>
            {saving ? "..." : t("teams.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
