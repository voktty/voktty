import { useTranslation } from "@/modules/i18n";
import { useHarnessSettingsBridge } from "@/modules/harness/lib/settingsBridge";
import { ChatPage } from "@/modules/harness/surfaces/SettingsView";
import { McpSettings } from "@/modules/harness/surfaces/McpSettings";
import { SkillsPage } from "@/modules/harness/surfaces/SkillsPage";
import { SectionHeader } from "../components/SectionHeader";

export function AgenticSection() {
  const { t } = useTranslation();
  const cwd = useHarnessSettingsBridge((state) => state.context?.cwd ?? "~");
  return (
    <div className="space-y-8">
      <SectionHeader
        title={t("settings.agentic.title")}
        description={t("settings.agentic.description")}
      />
      <ChatPage />
      <SkillsPage cwd={cwd} />
      <McpSettings cwd={cwd} />
    </div>
  );
}
