import {
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HarnessWindowContext } from "@/modules/harness/components/HarnessWindowHost";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import { captureHarnessMemoryConversation } from "@/modules/harness/lib/harnessMemoryConversation";
import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";
import { HarnessProjectOwner } from "@/modules/harness/hooks/useHarnessProjectSelection";
import {
  harnessProjectEnvironmentFor,
  useHarnessProjectEnvStore,
} from "@/modules/harness/lib/harnessEnvStore";
import { ProjectMemoryButton } from "@/modules/workspace-kit/components/ProjectMemoryButton";
import { useActiveSurfaceStore } from "@/modules/surfaces/lib/activeSurfaceStore";
import { memorySurfaceRegistry } from "@/modules/workspace-kit/lib/memorySurface";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";

function useHarnessMemorySource(cwd: string) {
  const owner = useContext(HarnessProjectOwner);
  const runtime = useContext(HarnessWindowContext);
  const captureMemorySession = runtime?.engine.captureMemorySession;
  const views = runtime?.views;
  const holds = runtime?.holds;
  const projects = runtime?.projects;
  const capture = useRef<MemoryConversationCapture | null>(null);
  const admission = useWindowPersistenceAdmission(() =>
    capture.current?.release(),
  );
  const directory = useActiveSurfaceStore(({ surface }) => {
    if (!owner) return cwd;
    if (surface.kind !== "harness" || surface.ownerId !== owner.ownerId)
      return null;
    return surface.project === cwd ? (surface.folder ?? cwd) : cwd;
  });
  const environment = useHarnessProjectEnvStore((state) =>
    harnessProjectEnvironmentFor(cwd, state.projects),
  );
  const ownerId = owner?.ownerId;
  const tabKey = owner?.tabKey;
  const environmentKey = JSON.stringify(environment);
  const isCurrent = useCallback(() => {
    const surface = useActiveSurfaceStore.getState().surface;
    const env = harnessProjectEnvironmentFor(
      cwd,
      useHarnessProjectEnvStore.getState().projects,
    );
    return (
      surface.kind === "harness" &&
      surface.ownerId === ownerId &&
      surface.project === cwd &&
      (surface.folder ?? cwd) === directory &&
      JSON.stringify(env) === environmentKey
    );
  }, [cwd, directory, ownerId, environmentKey]);
  const captureConversation = useCallback(() => {
    const permit = admission.getOwner()?.capture();
    if (
      ownerId === undefined || !captureMemorySession || !views || !holds ||
      !projects || !permit || environment.env.kind !== "local" || !isCurrent()
    )
      return null;
    const current = (sessionId?: string) => {
      const surface = useActiveSurfaceStore.getState().surface;
      const env = harnessProjectEnvironmentFor(
        cwd,
        useHarnessProjectEnvStore.getState().projects,
      );
      return (
        permit.isCurrent() &&
        !projects.has(cwd) &&
        (!sessionId || !holds.hasAny(sessionId)) &&
        !env.error &&
        !env.connecting &&
        env.env.kind === "local" &&
        surface.kind === "harness" &&
        surface.ownerId === ownerId &&
        surface.project === cwd &&
        (surface.folder ?? cwd) === directory
      );
    };
    capture.current?.release();
    capture.current = captureHarnessMemoryConversation(
      { captureMemorySession },
      views,
      ownerId,
      cwd,
      {
        isCurrent: current,
        subscribe(listener) {
          const subscriptions: (() => void)[] = [];
          try {
            for (const subscribe of [
              useActiveSurfaceStore.subscribe,
              useHarnessProjectEnvStore.subscribe,
              holds.subscribe,
              projects.subscribe,
            ])
              subscriptions.push(subscribe(listener));
          } catch (error) {
            for (const unsubscribe of subscriptions) unsubscribe();
            throw error;
          }
          return () => {
            for (const unsubscribe of subscriptions) unsubscribe();
          };
        },
      },
    );
    return capture.current;
  }, [
    admission.getOwner,
    ownerId,
    captureMemorySession,
    views,
    holds,
    projects,
    cwd,
    directory,
    environment.env.kind,
    isCurrent,
  ]);
  const targetKey = JSON.stringify(
    directory &&
      directory !== "~" &&
      !environment.error &&
      !environment.connecting
      ? {
          path: directory,
          environment: environment.env,
          source: `harness:${owner?.ownerId ?? "standalone"}:${owner?.tabKey ?? ""}`,
        }
      : null,
  );
  const target = useMemo(
    () => JSON.parse(targetKey) as MemoryPanelTarget | null,
    [targetKey],
  );
  return {
    target,
    captureConversation,
    isCurrent,
    source: `harness:${ownerId ?? "standalone"}:${tabKey ?? ""}`,
  };
}

export function HarnessProjectMemoryButton({ cwd }: { cwd: string }) {
  const source = useHarnessMemorySource(cwd);
  return (
    <ProjectMemoryButton
      rail
      target={source.target}
      captureConversation={source.captureConversation}
    />
  );
}

export function HarnessActiveMemorySource() {
  const [revision, setRevision] = useState(0);
  const retiredRevision = useRef<number | null>(null);
  const owner = useContext(HarnessProjectOwner);
  const project = useActiveSurfaceStore(({ surface }) =>
    surface.kind === "harness" && surface.ownerId === owner?.ownerId
      ? surface.project
      : null,
  );
  const { target, captureConversation, isCurrent, source } =
    useHarnessMemorySource(project ?? "");
  useLayoutEffect(() => {
    if (!project || !isCurrent() || retiredRevision.current === revision) return;
    const release = memorySurfaceRegistry.publish({
      source,
      target,
      captureConversation,
      isCurrent,
    });
    let retired = false;
    const changed = () => {
      if (retired || isCurrent()) return;
      retired = true;
      retiredRevision.current = revision;
      release();
      setRevision((value) => value + 1);
    };
    const stopSurface = useActiveSurfaceStore.subscribe(changed);
    const stopEnvironment = useHarnessProjectEnvStore.subscribe(changed);
    return () => {
      retired = true;
      stopSurface();
      stopEnvironment();
      release();
    };
  }, [project, source, target, captureConversation, isCurrent, revision]);
  return null;
}
