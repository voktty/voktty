import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { normalizeProjectPath, sameProjectPath } from "../lib/recents";

export type ProjectAvailability = {
  unavailablePaths: Set<string>;
  recheckPath: (path: string) => Promise<boolean>;
  checkAvailability: () => Promise<void>;
};

export function useProjectAvailability(paths: string[]): ProjectAvailability {
  const [unavailablePaths, setUnavailablePaths] = useState<Set<string>>(
    () => new Set(),
  );

  const recheckPath = useCallback(async (path: string): Promise<boolean> => {
    const norm = normalizeProjectPath(path);
    if (!norm || norm === "~" || norm === "/") return true;
    try {
      const infos = await invoke<
        Array<{ path: string; isDir: boolean; name?: string }>
      >("inspect_paths", { paths: [norm] });
      const exists = (infos ?? []).some(
        (info) => info && (info.isDir || Boolean(info.path)),
      );
      setUnavailablePaths((prev) => {
        const next = new Set(prev);
        if (exists) {
          for (const item of prev) {
            if (sameProjectPath(item, norm)) next.delete(item);
          }
        } else {
          next.add(norm);
        }
        return next;
      });
      return exists;
    } catch {
      return true;
    }
  }, []);

  const checkAvailability = useCallback(async () => {
    const valid = paths.filter((p) => p && p !== "~" && p !== "/");
    if (valid.length === 0) {
      setUnavailablePaths(new Set());
      return;
    }
    try {
      const infos = await invoke<
        Array<{ path: string; isDir: boolean; name?: string }>
      >("inspect_paths", { paths: valid });

      const existingSet = new Set(
        (infos ?? [])
          .filter((info) => info && (info.isDir || Boolean(info.path)))
          .map((info) => normalizeProjectPath(info.path)),
      );

      // Materialized once: sameProjectPath is a fuzzy comparison so the set
      // cannot be probed directly, but rebuilding the array per project made
      // this quadratic in allocations as well as in comparisons.
      const existing = Array.from(existingSet);
      const missing = new Set<string>();
      for (const p of valid) {
        const norm = normalizeProjectPath(p);
        if (!existing.some((e) => sameProjectPath(e, norm))) {
          missing.add(norm);
        }
      }
      setUnavailablePaths(missing);
    } catch {
      // In test/mock environments or if Tauri is unavailable, don't mark as missing
    }
  }, [paths]);

  useEffect(() => {
    void checkAvailability();
    const interval = setInterval(() => {
      // Each pass stats every project path. A hidden window has nothing to
      // repaint with the answer, and the focus listener below rechecks the
      // moment it comes back, so nothing is lost by skipping.
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

  return { unavailablePaths, recheckPath, checkAvailability };
}
