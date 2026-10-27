import type { FilePaneTab } from "@/modules/harness/lib/layout";
import { sameLegacyTerminal } from "@/modules/harness/lib/legacyTerminalMapping";
import type { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import type { ProjectTerminalReference } from "@/modules/terminal/lib/projectTerminalRequest";
import { hiddenLegacyTerminals } from "@/modules/harness/lib/legacyTerminalCandidates";

class RetiredTerminalMigration extends Error {
  constructor() {
    super("Terminal migration was retired.");
  }
}

export function createLegacyTerminalMigrations(
  views: ReturnType<typeof createHarnessWindowViews>,
) {
  let live = true;
  const entries = new Map<
    string,
    {
      source: FilePaneTab;
      projectCwd: string;
      cold: boolean;
      result: Promise<ProjectTerminalReference>;
    }
  >();
  return {
    views,
    coldCandidates(projectCwd: string) {
      if (!live) return [];
      return hiddenLegacyTerminals(views.getSnapshot(), projectCwd, true);
    },
    canMigrateCold(file: FilePaneTab, projectCwd: string) {
      if (!live) return false;
      try {
        views.validateTerminalMigration(file, projectCwd);
      } catch {
        return false;
      }
      return hiddenLegacyTerminals(views.getSnapshot(), projectCwd, true).some(
        (candidate) => sameLegacyTerminal(candidate, file),
      );
    },
    run: function run(
      file: FilePaneTab,
      projectCwd: string,
      isCurrent: () => boolean,
      create: () => Promise<ProjectTerminalReference>,
      cold = false,
    ): Promise<ProjectTerminalReference> {
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
        return previous.cold
          ? previous.result.catch((error: unknown) => {
              if (
                !(error instanceof RetiredTerminalMigration) ||
                !live ||
                !isCurrent()
              )
                throw error;
              return run(file, projectCwd, isCurrent, create, cold);
            })
          : previous.result;
      }
      if (!live || entries.size >= 256)
        return Promise.reject(
          new Error("Legacy terminal migration is unavailable."),
        );
      const source = Object.freeze({ ...file });
      const result = Promise.resolve().then(async () => {
        if (!live || !isCurrent()) throw new RetiredTerminalMigration();
        views.validateTerminalMigration(source, projectCwd);
        try {
          return await create();
        } catch (error) {
          if (!live || !isCurrent()) throw new RetiredTerminalMigration();
          throw error;
        }
      });
      const entry = { source, projectCwd, result, cold };
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
