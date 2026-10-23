import type { useHarnessWindow } from "@/modules/harness/components/HarnessWindowHost";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { restrictPersistencePermit } from "@/modules/harness/lib/scopedPersistencePermit";
import { sameRemovalProject } from "@/modules/harness/lib/retainedSessionReferences";
import {
  looksLikeProject,
  normalizeProjectPath,
  isRemoteProjectPath,
} from "@/modules/harness/lib/recents";
import { sessionChildHarnesses } from "@/modules/harness/lib/handoff";
import {
  forgetHarnessSession,
  stopStreaming,
} from "@/modules/harness/lib/harness";
import {
  shouldPersistSession,
  upsertSessions,
} from "@/modules/harness/lib/sessionStore";
import { removeProjectData } from "@/modules/harness/lib/projectData";

export async function runProjectRemoval({
  runtime,
  path,
  purgeData,
  permit,
  commitRail,
  disconnect,
}: {
  runtime: Pick<
    ReturnType<typeof useHarnessWindow>,
    "projects" | "removals" | "engine" | "transcripts"
  >;
  path: string;
  purgeData: boolean;
  permit: PersistencePermit;
  commitRail: (isCurrent: () => boolean) => void;
  disconnect: () => Promise<void>;
}): Promise<boolean> {
  const projectPath = normalizeProjectPath(path);
  if (!looksLikeProject(projectPath)) return false;
  const project = runtime.projects.reserve(projectPath, permit);
  if (!project) return false;
  try {
    return await project.perform(async () => {
      const sessions = runtime.engine.sessionsRef.current.filter((session) =>
        sameRemovalProject(session.cwd, projectPath),
      );
      const originals = sessions.map((session) =>
        runtime.engine.captureSessionLifetime(session.id),
      );
      let removed = false;
      const current = () =>
        project.isCurrent() && (removed || originals.every((check) => check()));
      const request = restrictPersistencePermit(project, current);
      const operation = await runtime.removals.prepare(
        null,
        sessions.map((session) => session.id),
        request,
        "removing",
        { path: projectPath, owner: project },
      );
      if (!operation) return false;
      try {
        return await operation.perform(async () => {
          if (!(await operation.commit())) return false;
          const removable: string[] = [];
          for (const original of sessions) {
            if (!operation.isCurrent()) return false;
            let session = runtime.engine.readSession(original.id);
            if (!session) return false;
            if (!purgeData && session.busy) continue;
            runtime.transcripts.dropPending(session.id);
            if (purgeData) {
              session = await runtime.engine.stopSessionForRemoval(session.id);
              if (!operation.isCurrent() || !session) return false;
              const stopped = {
                ...stopStreaming(session),
                queueStatus: "paused" as const,
              };
              runtime.engine.updateSession(
                session.id,
                () => stopped,
                "immediate",
              );
              session = stopped;
            }
            if (
              (!purgeData || isRemoteProjectPath(projectPath)) &&
              shouldPersistSession(session)
            ) {
              const saved = session;
              if (
                !(await operation.run(async () => {
                  const summaries = await upsertSessions([saved]);
                  if (!summaries.some((summary) => summary.id === saved.id))
                    throw new Error("The conversation could not be saved.");
                  if (operation.isCurrent())
                    runtime.transcripts.markPersisted(saved);
                }))
              )
                return false;
            }
            if (!operation.isCurrent()) return false;
            const outcomes = await Promise.allSettled(
              sessionChildHarnesses(session).map((harness) =>
                operation.isCurrent()
                  ? forgetHarnessSession(harness, session.id)
                  : Promise.resolve(),
              ),
            );
            const failure = outcomes.find(
              (outcome) => outcome.status === "rejected",
            );
            if (failure) throw failure.reason;
            if (!operation.isCurrent()) return false;
            runtime.transcripts.dropPending(session.id);
            removable.push(session.id);
          }
          if (
            purgeData &&
            !(await removeProjectData(
              projectPath,
              operation,
              sessions.map((session) => session.id),
            ))
          )
            return false;
          if (!operation.isCurrent()) return false;
          removed = true;
          runtime.engine.applySessionDeltas(
            removable.map((id) => ({ kind: "remove" as const, id })),
            "immediate",
          );
          for (const id of removable) {
            runtime.transcripts.dropPending(id);
            runtime.transcripts.forgetFingerprint(id);
          }
          if (
            !(await operation.run(async () => {
              if (operation.isCurrent()) commitRail(operation.isCurrent);
            }))
          )
            return false;
          if (!operation.isCurrent()) return false;
          await disconnect();
          return operation.isCurrent();
        });
      } finally {
        operation.release();
      }
    });
  } finally {
    project.release();
  }
}
