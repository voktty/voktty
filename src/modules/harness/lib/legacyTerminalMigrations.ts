import type { FilePaneTab } from "@/modules/harness/lib/layout";
import { sameLegacyTerminal } from "@/modules/harness/lib/legacyTerminalMapping";
import type { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import type { captureLegacyPtyMigration } from "@/modules/harness/lib/pty";
import type { ProjectTerminalReference } from "@/modules/terminal/lib/projectTerminalRequest";

export function createLegacyTerminalMigrations(
  views: ReturnType<typeof createHarnessWindowViews>,
  capture: typeof captureLegacyPtyMigration,
  confirm: (file: FilePaneTab) => Promise<boolean>,
) {
  let live = true;
  const entries = new Map<
    string,
    {
      source: FilePaneTab;
      projectCwd: string;
      result: Promise<ProjectTerminalReference>;
    }
  >();
  return {
    views,
    run(
      file: FilePaneTab,
      projectCwd: string,
      isCurrent: () => boolean,
      create: () => Promise<ProjectTerminalReference>,
    ) {
      if (!live)
        return Promise.reject(new Error("Terminal migration was retired."));
      views.validateTerminalMigration(file, projectCwd);
      const previous = entries.get(file.id);
      if (previous) {
        if (
          !sameLegacyTerminal(previous.source, file) ||
          previous.projectCwd !== projectCwd
        )
          return Promise.reject(
            new Error("Conflicting legacy terminal migration."),
          );
        return previous.result;
      }
      if (!live || entries.size >= 256)
        return Promise.reject(
          new Error("Legacy terminal migration is unavailable."),
        );
      const source = Object.freeze({ ...file });
      const result = Promise.resolve().then(async () => {
        if (!live || !isCurrent())
          throw new Error("Terminal migration was retired.");
        views.validateTerminalMigration(source, projectCwd);
        const captured = capture(source.id);
        try {
          if (!(await confirm(source)) || !live || !isCurrent())
            throw new Error("Terminal migration was declined or retired.");
          views.validateTerminalMigration(source, projectCwd);
          await captured.close();
          if (!live || !isCurrent())
            throw new Error("Terminal migration was retired.");
          return await create();
        } finally {
          captured.release();
        }
      });
      const entry = { source, projectCwd, result };
      entries.set(file.id, entry);
      void result.catch(() => {
        if (entries.get(file.id) === entry) entries.delete(file.id);
      });
      return result;
    },
    dispose() {
      live = false;
    },
  };
}
