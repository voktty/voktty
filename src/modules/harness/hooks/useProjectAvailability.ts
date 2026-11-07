import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { pingSshHost } from "@/modules/ssh/types";
import {
  localDirectoryExists,
  remoteAvailabilityPlan,
  type ProjectUnavailableReason,
} from "../lib/projectAvailability";
import {
  isRemoteProjectPath,
  normalizeProjectPath,
  sameProjectPath,
} from "../lib/recents";

export type ProjectAvailability = {
  unavailablePaths: Set<string>;
  unavailableReasons: ReadonlyMap<string, ProjectUnavailableReason>;
  recheckPath: (path: string) => Promise<boolean>;
  checkAvailability: () => Promise<void>;
};

type PathInfo = { path: string; isDir: boolean; name?: string };

/** A TCP probe per saved host is cheap, but a rail of projects must not repeat it every pass. */
const HOST_PROBE_TTL_MS = 30_000;

export function useProjectAvailability(paths: string[]): ProjectAvailability {
  const [reasons, setReasons] = useState<
    ReadonlyMap<string, ProjectUnavailableReason>
  >(() => new Map());
  const sshConnections = usePreferencesStore((state) => state.sshConnections);
  const connectionsRef = useRef(sshConnections ?? []);
  connectionsRef.current = sshConnections ?? [];
  const probes = useRef(new Map<string, { at: number; online: boolean }>());

  const probeHost = useCallback(
    async (key: string, host: string, port: number, force = false) => {
      const cached = probes.current.get(key);
      if (!force && cached && Date.now() - cached.at < HOST_PROBE_TTL_MS) {
        return cached.online;
      }
      const result = await pingSshHost(host, port);
      probes.current.set(key, { at: Date.now(), online: result.online });
      return result.online;
    },
    [],
  );

  const remoteReason = useCallback(
    async (
      path: string,
      force = false,
    ): Promise<ProjectUnavailableReason | null> => {
      const plan = remoteAvailabilityPlan(path, connectionsRef.current);
      if (plan.kind === "skip") return null;
      if (plan.kind === "profile-missing") return "profile-missing";
      return (await probeHost(plan.key, plan.host, plan.port, force))
        ? null
        : "host-unreachable";
    },
    [probeHost],
  );

  const recheckPath = useCallback(
    async (path: string): Promise<boolean> => {
      const norm = normalizeProjectPath(path);
      if (!norm || norm === "~" || norm === "/") return true;
      let reason: ProjectUnavailableReason | null;
      if (isRemoteProjectPath(norm)) {
        reason = await remoteReason(norm, true);
      } else {
        try {
          const infos = await invoke<PathInfo[]>("inspect_paths", {
            paths: [norm],
          });
          reason = localDirectoryExists(infos) ? null : "missing-directory";
        } catch {
          return true;
        }
      }
      setReasons((prev) => {
        const next = new Map(prev);
        for (const item of prev.keys()) {
          if (sameProjectPath(item, norm)) next.delete(item);
        }
        if (reason) next.set(norm, reason);
        return next;
      });
      return reason === null;
    },
    [remoteReason],
  );

  const checkAvailability = useCallback(async () => {
    const local = paths.filter(
      (p) => p && p !== "~" && p !== "/" && !isRemoteProjectPath(p),
    );
    const remote = paths.filter((p) => p && isRemoteProjectPath(p));
    const next = new Map<string, ProjectUnavailableReason>();

    if (local.length > 0) {
      try {
        const infos = await invoke<PathInfo[]>("inspect_paths", {
          paths: local,
        });
        const directories = Array.from(
          new Set(
            (infos ?? [])
              .filter((info) => info?.isDir)
              .map((info) => normalizeProjectPath(info.path)),
          ),
        );
        for (const p of local) {
          const norm = normalizeProjectPath(p);
          if (!directories.some((e) => sameProjectPath(e, norm))) {
            next.set(norm, "missing-directory");
          }
        }
      } catch {
        // Tauri unavailable (tests, early boot): do not mark anything missing.
      }
    }

    const outcomes = await Promise.all(
      remote.map(async (p) => [normalizeProjectPath(p), await remoteReason(p)] as const),
    );
    for (const [norm, reason] of outcomes) {
      if (reason) next.set(norm, reason);
    }
    setReasons(next);
  }, [paths, remoteReason]);

  useEffect(() => {
    void checkAvailability();
    const interval = setInterval(() => {
      // A hidden window has nothing to repaint; the focus listener rechecks on return.
      if (document.hidden) return;
      void checkAvailability();
    }, 10000);
    const onFocus = () => {
      void checkAvailability();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkAvailability]);

  const unavailablePaths = useMemo(() => new Set(reasons.keys()), [reasons]);
  return {
    unavailablePaths,
    unavailableReasons: reasons,
    recheckPath,
    checkAvailability,
  };
}
