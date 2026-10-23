import { useEffect, useRef } from "react";
import type { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import type { PersistenceOwner } from "@/modules/harness/lib/persistenceAdmission";
import {
  isLiveHarness,
  probeHarnessAvailability,
  refreshHarnessCatalogs,
  registerBuiltinHarnesses,
} from "@/modules/harness/lib/harness";
import { mergeModelSettings, resolveModel } from "@/modules/harness/lib/models";

export function useHarnessCatalogBootstrap(
  engine: ReturnType<typeof useHarnessSessionEngine>,
  getOwner: () => PersistenceOwner | null,
  revision: number,
) {
  const { sessionsRef, captureSessionLifetime, updateSessions } = engine;
  const currentRevision = useRef(revision);
  currentRevision.current = revision;
  const harnessKey = JSON.stringify(
    [...new Set(engine.sessions.map((session) => session.harness))].sort(),
  );
  useEffect(() => {
    if (
      currentRevision.current !== revision ||
      JSON.stringify(
        [
          ...new Set(sessionsRef.current.map((session) => session.harness)),
        ].sort(),
      ) !== harnessKey
    )
      return;
    const permit = getOwner()?.capture();
    if (!permit) return;
    let active = true;
    const sessions = sessionsRef.current;
    const owners = new Map(
      sessions.map((session) => [
        session.id,
        captureSessionLifetime(session.id),
      ]),
    );
    const ids = [...owners.keys()];
    const harnesses = [...new Set(sessions.map((session) => session.harness))];
    registerBuiltinHarnesses();
    void probeHarnessAvailability({ ids: harnesses }).catch(() => undefined);
    void refreshHarnessCatalogs(harnesses)
      .then(() => {
        if (!active || !permit.isCurrent()) return;
        updateSessions(ids, (session) => {
          if (
            !active ||
            !permit.isCurrent() ||
            !owners.get(session.id)?.() ||
            !isLiveHarness(session.harness)
          )
            return session;
          const model = resolveModel(session.harness, session.model);
          const settings = mergeModelSettings(model, session.modelSettings);
          const before = session.modelSettings ?? {};
          const after = settings ?? {};
          if (
            model.id === session.model &&
            Object.keys(before).length === Object.keys(after).length &&
            Object.keys(before).every((key) => before[key] === after[key])
          )
            return session;
          return { ...session, model: model.id, modelSettings: settings };
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    harnessKey,
    revision,
    sessionsRef,
    captureSessionLifetime,
    updateSessions,
    getOwner,
  ]);
}
