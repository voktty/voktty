import { notifyDocumentSaved } from "@/modules/lsp";
import {
  isPathInRemoteWorkspace,
  remoteReadDocument,
  remoteStat,
  remoteWriteFile,
} from "@/modules/remote";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type WorkspaceEnv,
  workspaceForDocumentPath,
  workspaceForNativeFs,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import { detectEol, type Eol, normalizeToLf, restoreEol } from "./eol";
import { classifyMediaExtension } from "./media";

type ReadResult =
  | { kind: "text"; content: string; size: number; mtime: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type FileStat = { size: number; mtime: number; kind: string };

/// Mirrors FORCE_MAX_READ_BYTES in src-tauri fs/file.rs.
export const FORCE_READ_LIMIT = 50 * 1024 * 1024;
export const DOCUMENT_SLOW_READ_MS = 2_000;
export const DOCUMENT_READ_TIMEOUT_MS = 30_000;

export type DocumentReadErrorKind =
  | "offline"
  | "not-found"
  | "permission-denied"
  | "unknown";

export function classifyDocumentReadError(error: unknown): DocumentReadErrorKind {
  const message = String(error).toLowerCase();
  if (
    /permission denied|access (?:is )?denied|eacces|eperm|os error 5\b/.test(
      message,
    )
  ) {
    return "permission-denied";
  }
  if (
    /timed? out|network (?:filesystem (?:is )?busy|(?:path )?(?:is )?(?:unreachable|unavailable))|host unreachable|connection (?:reset|refused)|os error (?:53|64|67|121|1231)\b/.test(
      message,
    )
  ) {
    return "offline";
  }
  if (
    /not found|cannot find|could not find|enoent|os error (?:2|3)\b/.test(message)
  ) {
    return "not-found";
  }
  return "unknown";
}

export type DocumentState =
  | { status: "loading" }
  | { status: "slow" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | {
      status: "error";
      kind: DocumentReadErrorKind;
      message: string;
    }
  | { status: "cancelled" };

type Options = {
  path: string;
  workspaceEnv: WorkspaceEnv;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useDocument({ path, workspaceEnv, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);
  const [eol, setEol] = useState<Eol>("\n");

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const eolRef = useRef<Eol>("\n");
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const diskMtimeRef = useRef<number | null>(null);

  const updateEol = useCallback((next: Eol) => {
    eolRef.current = next;
    setEol(next);
  }, []);

  const writeToDisk = useCallback(async () => {
    const content = bufferRef.current;
    const workspace = workspaceForDocumentPath(workspaceEnv, path);
    const nextContent = restoreEol(content, eolRef.current);
    const mtime = isPathInRemoteWorkspace(workspace, path)
      ? await remoteWriteFile(workspace, path, nextContent)
      : await invoke<number>("fs_write_file", {
          path,
          content: nextContent,
          workspace: workspaceForNativeFs(workspace, path),
          source: "editor",
        });
    diskMtimeRef.current = mtime;
    savedRef.current = content;
    // Edits typed while the write was in flight must stay dirty.
    setDirty(bufferRef.current !== content);
    notifyDocumentSaved(path);
  }, [path, workspaceEnv]);

  // False when the write was withheld because the file changed on disk
  // since load; overwriting is an explicit user action from the toast.
  const saveNow = useCallback(async (): Promise<boolean> => {
    const known = diskMtimeRef.current;
    if (known !== null) {
      const workspace = workspaceForDocumentPath(workspaceEnv, path);
      const stat = isPathInRemoteWorkspace(workspace, path)
        ? await remoteStat(workspace, path).catch(() => null)
        : await invoke<FileStat>("fs_stat", {
            path,
            workspace: workspaceForNativeFs(workspace, path),
          }).catch(() => null);
      if (stat && stat.mtime !== known) {
        const name = path.split(/[\\/]/).pop() ?? path;
        toast.warning(t("feedback.fileChangedOnDisk"), {
          id: `save-conflict:${path}`,
          description: t("feedback.fileChangedDescription", { name }),
          action: {
            label: t("feedback.overwrite"),
            onClick: () => void writeToDisk(),
          },
        });
        return false;
      }
    }
    await writeToDisk();
    return true;
  }, [path, workspaceEnv, writeToDisk]);

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  const forceRef = useRef(false);
  const readGenerationRef = useRef(0);

  // Adopts a read result as the new saved baseline. `skipIfUnchanged` avoids
  // the re-render when disk already matches the buffer (self-save / duplicate
  // watcher event); initial loads must always publish a state.
  const adoptRead = useCallback(
    (res: ReadResult, skipIfUnchanged = false) => {
      if (res.kind === "text") {
        updateEol(detectEol(res.content));
        diskMtimeRef.current = res.mtime;
        const content = normalizeToLf(res.content);
        if (skipIfUnchanged && content === savedRef.current) return;
        savedRef.current = content;
        bufferRef.current = content;
        setDirty(false);
        setDoc({ status: "ready", content, size: res.size });
      } else if (res.kind === "binary") {
        setDoc({ status: "binary", size: res.size });
      } else if (res.kind === "toolarge") {
        setDoc({ status: "toolarge", size: res.size, limit: res.limit });
      }
    },
    [updateEol],
  );

  const readFromDisk = useCallback(
    (force: boolean) => {
      const workspace = workspaceForDocumentPath(workspaceEnv, path);
      if (isPathInRemoteWorkspace(workspace, path)) {
        const extension = path.split(".").pop() ?? "";
        return remoteReadDocument(
          workspace,
          path,
          classifyMediaExtension(extension) !== null,
        );
      }
      return invoke<ReadResult>("fs_read_file", {
        path,
        workspace: workspaceForNativeFs(workspace, path),
        force,
      });
    },
    [path, workspaceEnv],
  );

  const loadDocument = useCallback(
    async (force: boolean) => {
      const generation = ++readGenerationRef.current;
      setDoc({ status: "loading" });
      const slowTimer = setTimeout(() => {
        if (readGenerationRef.current === generation) {
          setDoc({ status: "slow" });
        }
      }, DOCUMENT_SLOW_READ_MS);
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(
            () => reject(new Error("Document read timed out")),
            DOCUMENT_READ_TIMEOUT_MS,
          );
        });
        const result = await Promise.race([readFromDisk(force), timeout]);
        if (readGenerationRef.current === generation) adoptRead(result);
      } catch (error) {
        if (readGenerationRef.current === generation) {
          setDoc({
            status: "error",
            kind: classifyDocumentReadError(error),
            message: String(error),
          });
        }
      } finally {
        clearTimeout(slowTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
    },
    [adoptRead, readFromDisk],
  );

  const [externalChange, setExternalChange] = useState(false);

  const notifyExternalChange = useCallback(() => {
    setExternalChange(true);
  }, []);

  const dismissExternalChange = useCallback(() => {
    setExternalChange(false);
  }, []);

  const checkExternalChange = useCallback(async () => {
    if (doc.status !== "ready") return false;
    const known = diskMtimeRef.current;
    if (known === null) return false;
    const workspace = workspaceForDocumentPath(workspaceEnv, path);
    const stat = isPathInRemoteWorkspace(workspace, path)
      ? await remoteStat(workspace, path).catch(() => null)
      : await invoke<FileStat>("fs_stat", {
          path,
          workspace: workspaceForNativeFs(workspace, path),
        }).catch(() => null);
    if (stat && stat.mtime > 0 && stat.mtime !== known) {
      setExternalChange(true);
      return true;
    }
    return false;
  }, [doc.status, path, workspaceEnv]);

  // Load on path change.
  useEffect(() => {
    clearAutoSaveTimer();
    setExternalChange(false);
    // "Open anyway" is a per-file decision; a new path starts unforced.
    forceRef.current = false;
    setDirty(false);
    void loadDocument(forceRef.current);

    return () => {
      readGenerationRef.current += 1;
      clearAutoSaveTimer();
    };
  }, [loadDocument, clearAutoSaveTimer]);

  const openAnyway = useCallback(() => {
    forceRef.current = true;
    void loadDocument(true);
  }, [loadDocument]);

  const retry = useCallback(() => {
    void loadDocument(forceRef.current);
  }, [loadDocument]);

  const cancelRead = useCallback(() => {
    readGenerationRef.current += 1;
    setDoc({ status: "cancelled" });
  }, []);

  const reload = useCallback(
    async (
      force = false,
    ): Promise<{ content: string; mtime: number } | null> => {
      if (!force && dirtyRef.current) {
        setExternalChange(true);
        return null;
      }
      const generation = ++readGenerationRef.current;
      try {
        const res = await readFromDisk(forceRef.current);
        if (generation === readGenerationRef.current && res.kind === "text") {
          adoptRead(res, false);
          setExternalChange(false);
          const normalized = normalizeToLf(res.content);
          return { content: normalized, mtime: res.mtime };
        }
        return null;
      } catch (e) {
        console.warn("[editor] reload failed", path, e);
        return null;
      }
    },
    [readFromDisk, adoptRead, path],
  );

  const save = useCallback(async (): Promise<boolean> => {
    clearAutoSaveTimer();
    if (bufferRef.current === savedRef.current) return true;
    return saveNow();
  }, [clearAutoSaveTimer, saveNow]);

  // Adopt externally formatted disk content as the saved baseline before the
  // matching editor dispatch lands, so the buffer never flashes dirty. The
  // formatter's own write must also become the known mtime, or the next save
  // would report it as an external conflict.
  // Returns the LF-normalized text the caller should dispatch.
  const adoptDiskText = useCallback(
    (diskText: string, mtime: number): string => {
      updateEol(detectEol(diskText));
      diskMtimeRef.current = mtime;
      const content = normalizeToLf(diskText);
      savedRef.current = content;
      setDirty(bufferRef.current !== content);
      return content;
    },
    [updateEol],
  );

  const onChange = useCallback(
    (next: string) => {
      bufferRef.current = next;
      const isDirty = next !== savedRef.current;
      setDirty(isDirty);

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => console.error("[autosave]", e));
        }, delay);
      }
    },
    [clearAutoSaveTimer, saveNow],
  );

  return {
    doc,
    dirty,
    eol,
    externalChange,
    notifyExternalChange,
    dismissExternalChange,
    checkExternalChange,
    onChange,
    save,
    reload,
    adoptDiskText,
    openAnyway,
    retry,
    cancelRead,
  };
}
