import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/modules/i18n";
import {
  useMaskEmails,
  useShowRemainingUsage,
  saveMaskEmails,
  saveShowRemainingUsage,
} from "@/modules/harness/lib/displayPrefs";

export function HarnessUsageDisplaySettings() {
  const { t } = useTranslation();
  const showRemainingUsage = useShowRemainingUsage();
  const maskEmails = useMaskEmails();

  return (
    <section
      className="flex flex-col gap-2"
      data-setting-title={t("harness.settings.usageDisplay")}
    >
      <h2 className="pt-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-widest">
        {t("harness.settings.usageDisplay")}
      </h2>
      <div className="rounded-lg border border-border/60 bg-card/40 px-3">
        <div className="flex items-center gap-6 border-b border-border/40 py-3 last:border-b-0">
          <span className="min-w-0 flex-1 text-[12px] font-medium text-foreground">
            {t("harness.settingsEntries.showRemainingUsage")}
          </span>
          <Switch
            aria-label={t("harness.settingsEntries.showRemainingUsage")}
            checked={showRemainingUsage}
            onCheckedChange={saveShowRemainingUsage}
          />
        </div>
        <div className="flex items-center gap-6 py-3">
          <span className="min-w-0 flex-1 text-[12px] font-medium text-foreground">
            {t("harness.settingsEntries.maskEmails")}
          </span>
          <Switch
            aria-label={t("harness.settingsEntries.maskEmails")}
            checked={maskEmails}
            onCheckedChange={saveMaskEmails}
          />
        </div>
      </div>
    </section>
  );
}
