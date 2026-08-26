import { native } from "@/modules/ai/lib/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseCargoToml,
  parseDockerCompose,
  parseGoMod,
  parseMakefile,
  parsePackageJson,
  parsePyprojectToml,
} from "./discoverProjectScripts";
import type { ProjectScript } from "./types";

const scriptsCache = new Map<string, { scripts: ProjectScript[]; timestamp: number }>();
const CACHE_TTL_MS = 10_000;

function joinPath(dir: string, file: string): string {
  const cleanDir = dir.replace(/[\\/]+$/, "");
  return `${cleanDir}/${file}`;
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    const res = await native.readFile(path);
    return res.kind === "text" ? res.content : null;
  } catch {
    return null;
  }
}

export function useProjectScripts(cwd: string | null | undefined) {
  const [scripts, setScripts] = useState<ProjectScript[]>([]);
  const [loading, setLoading] = useState(false);
  const currentCwdRef = useRef<string | null>(null);

  const scan = useCallback(async (targetCwd: string) => {
    const cached = scriptsCache.get(targetCwd);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setScripts(cached.scripts);
      return;
    }

    setLoading(true);
    try {
      const dirEntries = await native.readDir(targetCwd).catch(() => []);
      const fileNames = new Set(dirEntries.map((e) => e.name));
      const lockfiles = ["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "package-lock.json"].filter(
        (lf) => fileNames.has(lf),
      );

      const found: ProjectScript[] = [];

      // 1. package.json
      if (fileNames.has("package.json")) {
        const text = await readTextFile(joinPath(targetCwd, "package.json"));
        if (text) found.push(...parsePackageJson(text, lockfiles));
      }

      // 2. Cargo.toml (root or src-tauri)
      if (fileNames.has("Cargo.toml")) {
        const text = await readTextFile(joinPath(targetCwd, "Cargo.toml"));
        if (text) found.push(...parseCargoToml(text));
      } else if (fileNames.has("src-tauri")) {
        const text = await readTextFile(joinPath(targetCwd, "src-tauri/Cargo.toml"));
        if (text) {
          const tauriScripts = parseCargoToml(text).map((s) => ({
            ...s,
            id: `tauri-${s.id}`,
            command: `cargo ${s.name} --manifest-path src-tauri/Cargo.toml`,
          }));
          found.push(...tauriScripts);
        }
      }

      // 3. Makefile / makefile / GNUmakefile
      const makefileName = ["Makefile", "makefile", "GNUmakefile"].find((m) => fileNames.has(m));
      if (makefileName) {
        const text = await readTextFile(joinPath(targetCwd, makefileName));
        if (text) found.push(...parseMakefile(text));
      }

      // 4. docker-compose
      const composeName = [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
      ].find((c) => fileNames.has(c));
      if (composeName) {
        const text = await readTextFile(joinPath(targetCwd, composeName));
        if (text) found.push(...parseDockerCompose(text));
      }

      // 5. pyproject.toml
      if (fileNames.has("pyproject.toml")) {
        const text = await readTextFile(joinPath(targetCwd, "pyproject.toml"));
        if (text) found.push(...parsePyprojectToml(text));
      }

      // 6. go.mod
      if (fileNames.has("go.mod")) {
        const text = await readTextFile(joinPath(targetCwd, "go.mod"));
        if (text) found.push(...parseGoMod(text));
      }

      scriptsCache.set(targetCwd, { scripts: found, timestamp: Date.now() });
      if (currentCwdRef.current === targetCwd) {
        setScripts(found);
      }
    } finally {
      if (currentCwdRef.current === targetCwd) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    currentCwdRef.current = cwd ?? null;
    if (!cwd) {
      setScripts([]);
      setLoading(false);
      return;
    }
    void scan(cwd);
  }, [cwd, scan]);

  const refresh = useCallback(() => {
    if (cwd) {
      scriptsCache.delete(cwd);
      void scan(cwd);
    }
  }, [cwd, scan]);

  return { scripts, loading, refresh };
}
