import type { TabProject } from "@/modules/spaces/lib/projectTabGroups";

export function ProjectTabBadge({
  project,
}: {
  project: TabProject | undefined;
}) {
  return project ? (
    <span
      data-project-label
      title={project.description}
      className="max-w-24 truncate rounded bg-primary/10 px-1 text-[9px] font-medium text-primary/80"
    >
      {project.name}
    </span>
  ) : null;
}
