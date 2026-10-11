import {
  remoteSshConnectionForProfile,
  remoteSshEnvironmentId,
} from "@/modules/connections/model/remoteSshProfiles";
import { ChevronRight, Folder } from "@/modules/harness/chrome/icons";
import { SearchableSelect } from "@/modules/harness/chrome/SearchableSelect";
import { LAYER } from "@/modules/harness/lib/layers";
import { useTranslation } from "@/modules/i18n";
import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  type RemoteSessionInfo,
  requestRemoteResult,
} from "@/modules/remote/client";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useSshConnections } from "@/modules/ssh/sshStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  normalizeRemoteDirectoryRelative,
  normalizeRemoteProjectPath,
  type RemoteDirectoryListing,
  remoteDirectoryListing,
  remoteProjectPathIssue,
} from "../model/remoteProjectBrowser";
import { rememberRemoteProject } from "../model/remoteProjects";

/** Adds a remote project using a saved SSH profile. Browsing is optional. */
export function AddRemoteProjectDialog({
  initialConnectionId,
  onCancel,
  onOpen,
}: {
  initialConnectionId?: string;
  onCancel: () => void;
  /** Receives the new project's rail key. */
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  const sshConnections = useSshConnections();
  const preferencesLoaded = usePreferencesStore((state) => state.hydrated);
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? "");
  const profile =
    sshConnections.find((entry) => entry.id === connectionId) ??
    sshConnections[0];
  const connectionState = useMemo(() => {
    if (!profile) return { connection: undefined, error: "" };
    try {
      return {
        connection: remoteSshConnectionForProfile(profile),
        error: "",
      };
    } catch (reason) {
      return {
        connection: undefined,
        error: String(reason).replace(/^Error: /, ""),
      };
    }
  }, [profile]);
  const { connection } = connectionState;
  const [path, setPath] = useState("");
  const pathRef = useRef("");
  const [directory, setDirectory] = useState<RemoteDirectoryListing>();
  const [browseRequested, setBrowseRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const sessionRef = useRef<RemoteSessionInfo | undefined>(undefined);
  const rootRef = useRef<string | undefined>(undefined);
  const setRemotePath = useCallback((next: string) => {
    pathRef.current = next;
    setPath(next);
  }, []);

  useEffect(() => {
    if (sshConnections.some((entry) => entry.id === connectionId)) return;
    setConnectionId(sshConnections[0]?.id ?? "");
  }, [connectionId, sshConnections]);

  useEffect(() => {
    if (profile?.id !== connectionId) return;
    const initialPath = profile?.initialDirectory?.trim() ?? "";
    setRemotePath(remoteProjectPathIssue(initialPath) ? "" : initialPath);
    setDirectory(undefined);
    setBrowseRequested(false);
    setError("");
  }, [connectionId, profile?.id, profile?.initialDirectory, setRemotePath]);

  const cancel = useCallback(() => {
    alive.current = false;
    requestVersion.current++;
    onCancel();
  }, [onCancel]);
  // Set on every mount: development StrictMode mounts, unmounts and mounts
  // again, and responses after the first cleanup must still be shown.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel]);

  const browse = useCallback(
    async (next = "", updatePath = true) => {
      const session = sessionRef.current;
      const root = rootRef.current;
      if (!session || !root) return;
      const version = ++requestVersion.current;
      setLoading(true);
      setOpening(false);
      setError("");
      try {
        const relativePath = normalizeRemoteDirectoryRelative(next);
        const value = await requestRemoteResult<{
          entries: Array<{
            name: string;
            kind: "directory" | "file" | "symlink";
          }>;
        }>(session.session_id, "fs.readDir", {
          path: relativePath || ".",
        });
        if (
          !alive.current ||
          sessionRef.current?.session_id !== session.session_id ||
          version !== requestVersion.current
        )
          return;
        const listing = remoteDirectoryListing(
          root,
          relativePath,
          value.entries,
        );
        setDirectory(listing);
        if (updatePath || !pathRef.current.trim()) setRemotePath(listing.path);
      } catch (reason) {
        if (alive.current && version === requestVersion.current)
          setError(String(reason).replace(/^Error: /, ""));
      } finally {
        if (alive.current && version === requestVersion.current)
          setLoading(false);
      }
    },
    [setRemotePath],
  );

  useEffect(() => {
    let disposed = false;
    let sessionId: number | undefined;
    if (!browseRequested) {
      setDirectory(undefined);
      setLoading(false);
      return;
    }
    requestVersion.current++;
    setDirectory(undefined);
    setError("");
    if (!connection) {
      if (connectionState.error) setError(connectionState.error);
      setLoading(false);
      return;
    }
    setLoading(true);
    void openRemoteWorkspace(connection)
      .then(async (session) => {
        sessionId = session.session_id;
        if (disposed || !alive.current) {
          await closeRemoteWorkspace(session.session_id).catch(() => undefined);
          return;
        }
        sessionRef.current = session;
        rootRef.current = session.workspace_root;
        await browse("", false);
      })
      .catch((reason: unknown) => {
        if (!disposed && alive.current) {
          setError(String(reason).replace(/^Error: /, ""));
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      requestVersion.current++;
      if (sessionRef.current?.session_id === sessionId) {
        sessionRef.current = undefined;
        rootRef.current = undefined;
      }
      if (sessionId !== undefined) {
        void closeRemoteWorkspace(sessionId).catch(() => undefined);
      }
    };
  }, [browse, browseRequested, connection, connectionState.error]);

  const open = async () => {
    if (!profile || opening || loading) return;
    const pathIssue = remoteProjectPathIssue(path);
    if (pathIssue) {
      setError(t(`harness.connections.pathErrors.${pathIssue}`));
      return;
    }
    if (!connection) {
      setError(connectionState.error);
      return;
    }
    const version = ++requestVersion.current;
    setOpening(true);
    setError("");
    try {
      const remotePath = normalizeRemoteProjectPath(path);
      const parts = remotePath.split("/").filter(Boolean);
      const name = parts[parts.length - 1] ?? profile.name;
      const environmentId = remoteSshEnvironmentId(profile.id);
      const project = rememberRemoteProject(environmentId, {
        id: `ssh-${profile.id}-${remotePath}`,
        cwd: remotePath,
        name,
      });
      if (alive.current && version === requestVersion.current)
        onOpen(project.key);
    } catch (reason) {
      if (alive.current && version === requestVersion.current)
        setError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (alive.current && version === requestVersion.current)
        setOpening(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 z-0 cursor-default bg-black/40"
        onClick={cancel}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t("harness.connections.dialogTitle")}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
        className="voktty-floating-surface absolute z-[1] left-1/2 top-[16%] flex max-h-[70vh] w-[min(480px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-xl border border-content/10 p-4 text-popover-foreground shadow-2xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            {t("harness.connections.dialogTitle")}
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            {t("harness.connections.dialogDescription")}
          </p>
        </div>
        {!preferencesLoaded ? null : !profile ? (
          <>
            <p className="text-[12px] leading-snug text-content/55">
              {t("harness.connections.noProfilesDescription")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
              >
                {t("common.cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            {sshConnections.length > 1 ? (
              <SearchableSelect
                label={t("harness.connections.profile")}
                value={profile.id}
                options={sshConnections.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  keywords: `${entry.user ? `${entry.user}@` : ""}${entry.host}:${entry.port ?? 22}`,
                }))}
                onChange={(id) => {
                  setConnectionId(id);
                  const nextProfile = sshConnections.find(
                    (entry) => entry.id === id,
                  );
                  const initialPath =
                    nextProfile?.initialDirectory?.trim() ?? "";
                  setRemotePath(
                    remoteProjectPathIssue(initialPath) ? "" : initialPath,
                  );
                  setDirectory(undefined);
                  setBrowseRequested(false);
                  setError("");
                }}
                searchable
              />
            ) : (
              <p className="text-[12px] text-content/55">
                {t("harness.connections.onProfile")}{" "}
                <span className="text-content/80">{profile.name}</span>
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <input
                aria-label={t("harness.connections.folderPath")}
                className="h-9 shrink-0 rounded-md border border-content/10 bg-content/3 px-2.5 font-mono text-[12px] text-content outline-none focus:border-content/25"
                placeholder={t("harness.connections.pathPlaceholder")}
                value={path}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                onChange={(event) => {
                  setRemotePath(event.target.value);
                  setError("");
                }}
              />
              <p className="text-[11px] leading-snug text-content/45">
                {t("harness.connections.directPathHint")}
              </p>
            </div>
            <button
              type="button"
              disabled={opening || !connection}
              onClick={() => setBrowseRequested((requested) => !requested)}
              className="self-start rounded-md border border-content/10 px-2.5 py-1.5 text-[11px] text-content/70 hover:bg-content/5 hover:text-content disabled:opacity-40"
            >
              {browseRequested
                ? t("harness.connections.hideFolderBrowser")
                : t("harness.connections.browseFolders")}
            </button>
            {browseRequested ? (
              <section
                aria-label={t("harness.connections.folders")}
                className="min-h-24 max-h-52 flex-1 overflow-y-auto overscroll-contain rounded-md border border-content/10"
              >
                <div className="p-1">
                  {directory?.parentRelativePath !== null && directory ? (
                    <FolderRow
                      name=".."
                      onOpen={() =>
                        void browse(directory.parentRelativePath ?? "")
                      }
                    />
                  ) : null}
                  {directory?.entries.map((entry) => (
                    <FolderRow
                      key={entry.relativePath}
                      name={entry.name}
                      onOpen={() => void browse(entry.relativePath)}
                    />
                  ))}
                  {directory && !directory.entries.length ? (
                    <p className="px-2 py-1.5 text-[12px] text-content/45">
                      {t("harness.connections.noSubfolders")}
                    </p>
                  ) : null}
                  {!directory && loading ? (
                    <p className="px-2 py-1.5 text-[12px] text-content/45">
                      {t("harness.connections.loadingFolders")}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}
            {error || (!connection && connectionState.error) ? (
              <p
                role="alert"
                className="whitespace-pre-wrap break-words text-[12px] leading-snug text-red-400/90"
              >
                {error || connectionState.error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  opening || loading || !profile || !connection || !path.trim()
                }
                className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover disabled:opacity-40"
              >
                {opening ? t("harness.connections.opening") : t("common.open")}
              </button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

function FolderRow({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-content/75 hover:bg-content/8 hover:text-content"
    >
      <Folder
        className="size-3.5 shrink-0 text-content/45"
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronRight className="size-3 shrink-0 text-content/30" />
    </button>
  );
}
