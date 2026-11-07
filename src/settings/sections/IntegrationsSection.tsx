import { useTranslation } from "@/modules/i18n";
import { useHarnessSettingsBridge } from "@/modules/harness/lib/settingsBridge";
import { InboxPage } from "@/modules/harness/surfaces/SettingsView";
import { SectionHeader } from "../components/SectionHeader";

export function IntegrationsSection() {
  const { t } = useTranslation();
  const context = useHarnessSettingsBridge((state) => state.context);
  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("settings.integrations.title")}
        description={t("settings.integrations.description")}
      />
      <InboxPage
        cwd={context?.cwd ?? "~"}
        recents={context?.recents ?? []}
      />
    </div>
  );
}
