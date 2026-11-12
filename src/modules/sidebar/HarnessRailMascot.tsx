import { ProjectMascot } from "@/modules/harness/chrome/ProjectMascot";
import { projectKey, projectName } from "@/modules/harness/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "@/modules/harness/lib/tabGroups";

/** Loaded on demand so the Harness chrome stays out of the startup bundle. */
export default function HarnessRailMascot({
  cwd,
  running,
}: {
  cwd: string;
  running: boolean;
}) {
  const seed = projectName(cwd);
  const key = projectKey(cwd);
  return (
    <ProjectMascot
      project={seed}
      color={resolveTabGroupColor(
        key,
        loadTabGroupColors(),
        loadTabGroupCustomColors(),
        seed,
      )}
      name={resolveTabGroupMascot(key, loadTabGroupMascots())}
      className="size-4.5 shrink-0"
      active={running}
    />
  );
}
