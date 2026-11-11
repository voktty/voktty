import { ProjectMascot } from "@/modules/harness/chrome/ProjectMascot";
import { projectName } from "@/modules/harness/lib/paths";
import type { RecentProject } from "@/modules/harness/lib/recents";
import { resolveTabGroupColor } from "@/modules/harness/lib/tabGroups";
import { useTranslation } from "@/modules/i18n";

interface NotchProjectLauncherProps {
  projects: RecentProject[];
  onOpenProject: (path: string) => void;
  onClose?: () => void;
}

export function NotchProjectLauncher({
  projects,
  onOpenProject,
  onClose,
}: NotchProjectLauncherProps) {
  const { t } = useTranslation();

  if (projects.length === 0) return null;

  return (
    <div className="flex flex-col w-[380px] max-w-[90vw] bg-black text-foreground rounded-2xl border border-white/10 p-2.5 space-y-2 select-none animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between px-1.5 pb-1 border-b border-white/10">
        <span className="font-sans font-medium text-xs text-content/80">
          {t("harness.notch.idleLauncher")}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-content/60 hover:text-content hover:bg-white/10 transition-colors"
            title={t("harness.notch.close")}
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-[220px] overflow-y-auto p-0.5">
        {projects.map((project) => {
          const title = projectName(project.path);
          const color = resolveTabGroupColor(project.path);
          return (
            <button
              key={project.path}
              type="button"
              onClick={() => onOpenProject(project.path)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/12 border border-white/5 hover:border-white/15 text-left transition-all group"
              title={project.path}
            >
              <ProjectMascot
                project={project.path}
                active={false}
                color={color}
                className="size-4 shrink-0 drop-shadow-sm group-hover:scale-110 transition-transform"
              />
              <span className="font-medium text-xs text-content truncate max-w-[140px]">
                {title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
