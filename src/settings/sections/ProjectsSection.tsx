import { useTranslation } from "@/modules/i18n";
import { useHarnessSettingsBridge } from "@/modules/harness/lib/settingsBridge";
import { ArchivePage } from "@/modules/harness/surfaces/SettingsView";
import { removeWorktree } from "@/modules/harness/lib/worktrees";
import { WorktreesPage } from "@/modules/harness/surfaces/WorktreesPage";
import { SectionHeader } from "../components/SectionHeader";

export function ProjectsSection() {
  const { t } = useTranslation();
  const context = useHarnessSettingsBridge((state) => state.context);
  if (!context) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title={t("settings.projects.title")}
          description={t("settings.projects.description")}
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.projects.openHarness")}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <SectionHeader
        title={t("settings.projects.title")}
        description={t("settings.projects.description")}
      />
      <WorktreesPage
        cwd={context.cwd}
        recents={context.recents}
        onRemove={removeWorktree}
      />
      <ArchivePage
        cwd={context.cwd}
        sessions={context.sessions}
        onOpenSession={context.onOpenSession}
        onArchiveSession={context.onArchiveSession}
        onDeleteSession={context.onDeleteSession}
        onRestoreProject={context.onRestoreProject}
        onDeleteProject={context.onDeleteProject}
      />
    </div>
  );
}
