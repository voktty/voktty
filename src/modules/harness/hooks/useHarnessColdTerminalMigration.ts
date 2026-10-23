import { useContext, useEffect, useLayoutEffect, useRef } from "react";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import { HarnessTerminalMigrationContext } from "@/modules/harness/hooks/harnessTerminalMigrationContext";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { sameLegacyTerminal } from "@/modules/harness/lib/legacyTerminalMapping";
import { terminalTabLabel } from "@/modules/harness/lib/terminalTab";
import type { FilePaneTab } from "@/modules/harness/lib/layout";
import type { ProjectTerminalReference } from "@/modules/terminal/lib/projectTerminalRequest";
import type { useHarnessTerminalCreation } from "@/modules/harness/hooks/useHarnessTerminalCreation";
import { useCanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";

export function useHarnessColdTerminalMigration(props: {
  projectCwd: string;
  enabled: boolean;
  capture: () => PersistencePermit | undefined;
  open: ReturnType<typeof useHarnessTerminalCreation>["open"];
}) {
  const migrations = useContext(HarnessTerminalMigrationContext);
  const owner = useContext(HarnessTerminalOwner);
  const catalog = useCanonicalTerminalCatalog();
  const latest = useRef({ ...props, owner, catalog });
  const lifetime = useRef<object | null>(null);
  const running = useRef<object | null>(null);
  const attempted = useRef(
    new Map<string, { lifetime: object; file: FilePaneTab }>(),
  );
  useLayoutEffect(() => {
    latest.current = { ...props, owner, catalog };
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: These owner inputs retire pending admissions even when the view remains mounted.
  useLayoutEffect(() => {
    const original = {};
    lifetime.current = original;
    return () => {
      if (lifetime.current === original) lifetime.current = null;
    };
  }, [props.projectCwd, props.enabled, owner?.tabKey, owner?.visible]);
  useEffect(() => {
    const original = lifetime.current;
    const captured = latest.current;
    if (
      !migrations ||
      !original ||
      running.current === original ||
      !captured.enabled ||
      !captured.catalog ||
      !captured.owner?.visible
    )
      return;
    running.current = original;
    const active = () =>
      lifetime.current === original &&
      latest.current.enabled &&
      latest.current.owner?.visible === true;
    void (async () => {
      try {
        while (active()) {
          const candidates = migrations.coldCandidates(captured.projectCwd);
          const ids = new Set(candidates.map((candidate) => candidate.id));
          for (const id of attempted.current.keys())
            if (!ids.has(id)) attempted.current.delete(id);
          const file = candidates.find((candidate) => {
            const previous = attempted.current.get(candidate.id);
            return (
              previous?.lifetime !== original ||
              !sameLegacyTerminal(previous.file, candidate)
            );
          });
          if (!file) return;
          attempted.current.set(file.id, { lifetime: original, file });
          const permit = captured.capture();
          const current = () =>
            active() &&
            permit?.isCurrent() === true &&
            migrations.canMigrateCold(file, captured.projectCwd);
          if (!current()) continue;
          try {
            let createdCold = false;
            const reference = await migrations.run(
              file,
              captured.projectCwd,
              current,
              () =>
                new Promise<ProjectTerminalReference>((resolve, reject) => {
                  const accepted = captured.open({
                    cwd: file.cwd,
                    title: terminalTabLabel(file),
                    cold: true,
                    slotKey: `migration:${file.id}`,
                    isCurrent: current,
                    onCreated: () => {},
                    onConfirmed: (result) => {
                      createdCold = true;
                      resolve(result);
                      return undefined;
                    },
                    onFailed: reject,
                  });
                  if (!accepted)
                    reject(new Error("Cold terminal migration was declined."));
                }),
              true,
            );
            const target = { ...reference, projectCwd: captured.projectCwd };
            if (
              current() &&
              (createdCold ||
                latest.current.catalog?.get(target)?.cold === true)
            )
              migrations.views.migrateTerminal(file, target, current);
          } catch {
            /* A changed or live terminal retains its explicit presentation retry. */
          }
        }
      } finally {
        if (running.current === original) running.current = null;
      }
    })();
  });
}
