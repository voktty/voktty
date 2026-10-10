import { ChevronRight, Folder } from "@/modules/harness/chrome/icons";
import { SearchableSelect } from "@/modules/harness/chrome/SearchableSelect";
import { LAYER } from "@/modules/harness/lib/layers";
import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  type RemoteSessionInfo,
  requestRemoteResult,
} from "@/modules/remote/client";
import {
  remoteSshConnectionForProfile,
  remoteSshEnvironmentId,
} from "@/modules/connections/model/remoteSshProfiles";
import { useSshConnections } from "@/modules/ssh/sshStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  normalizeRemoteDirectoryRelative,
  type RemoteDirectoryListing,
  remoteDirectoryListing,
} from "../model/remoteProjectBrowser";
import { rememberRemoteProject } from "../model/remoteProjects";

/** Adds a remote project after browsing it through the native SSH helper. */
export function AddRemoteProjectDialog({
  onCancel,
  onOpen,
}: {
  onCancel: () => void;
  /** Receives the new project's rail key. */
  onOpen: (key: string) => void;
}) {
  const sshConnections = useSshConnections();
  const preferencesLoaded = usePreferencesStore((state) => state.hydrated);
  const [connectionId, setConnectionId] = useState("");
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
  const [directory, setDirectory] = useState<RemoteDirectoryListing>();
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const sessionRef = useRef<RemoteSessionInfo | undefined>(undefined);
  const rootRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sshConnections.some((entry) => entry.id === connectionId)) return;
    setConnectionId(sshConnections[0]?.id ?? "");
  }, [connectionId, sshConnections]);

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

  const browse = useCallback(async (next = "") => {
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
      const listing = remoteDirectoryListing(root, relativePath, value.entries);
      setDirectory(listing);
      setPath(listing.path);
    } catch (reason) {
      if (alive.current && version === requestVersion.current)
        setError(String(reason).replace(/^Error: /, ""));
    } finally {
      if (alive.current && version === requestVersion.current)
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let sessionId: number | undefined;
    requestVersion.current++;
    setDirectory(undefined);
    setPath("");
    setError("");
    setSessionReady(false);
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
        setSessionReady(true);
        await browse("");
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
  }, [browse, connection, connectionState.error]);

  const open = async () => {
    if (!profile || !sessionReady || !path.trim() || opening) return;
    const version = ++requestVersion.current;
    setOpening(true);
    setLoading(false);
    setError("");
    try {
      const parts = path.split("/").filter(Boolean);
      const name = parts[parts.length - 1] ?? path;
      const environmentId = remoteSshEnvironmentId(profile.id);
      const project = rememberRemoteProject(environmentId, {
        id: `ssh-${profile.id}-${path}`,
        cwd: path,
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
        className="absolute inset-0 z-0 cursor-default"
        onClick={cancel}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Open folder on a machine"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
        className="absolute z-[1] left-1/2 top-[16%] flex max-h-[70vh] w-[min(480px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-lg border border-content/10 bg-background-base dark:bg-content/5 p-4 shadow-xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            Open folder on a machine
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            Folder discovery and OpenCode 2.x sessions use the saved SSH profile
            through Voktty’s authenticated agent.
          </p>
        </div>
        {!preferencesLoaded ? null : !profile ? (
          <>
            <p className="text-[12px] leading-snug text-content/55">
              No saved SSH connections are available. Add a profile in SSH
              settings, then open its folder here.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {sshConnections.length > 1 ? (
              <SearchableSelect
                label="SSH connection"
                value={profile.id}
                options={sshConnections.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  keywords: `${entry.user ? `${entry.user}@` : ""}${entry.host}:${entry.port ?? 22}`,
                }))}
                onChange={setConnectionId}
                searchable
              />
            ) : (
              <p className="text-[12px] text-content/55">
                On <span className="text-content/80">{profile.name}</span>
              </p>
            )}
            <input
              aria-label="Folder path on the machine"
              className="h-8 shrink-0 rounded-md border border-content/10 bg-content/3 px-2.5 font-mono text-[12px] text-content outline-none focus:border-content/25"
              placeholder="Connecting over SSH…"
              value={path}
              readOnly
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              onChange={(event) => setPath(event.target.value)}
            />
            <section
              aria-label="Folders"
              className="min-h-24 flex-1 overflow-y-auto overscroll-contain rounded-md border border-content/10"
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
                    No subfolders
                  </p>
                ) : null}
                {!directory && loading ? (
                  <p className="px-2 py-1.5 text-[12px] text-content/45">
                    Connecting and loading folders…
                  </p>
                ) : null}
              </div>
            </section>
            {error ? (
              <p
                role="alert"
                className="whitespace-pre-wrap break-words text-[12px] leading-snug text-red-400/90"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  opening ||
                  loading ||
                  !profile ||
                  !sessionReady ||
                  !path.trim()
                }
                className="rounded-md bg-selection px-3 py-1.5 text-[12px] font-medium hover:bg-selection-hover disabled:opacity-40"
              >
                {opening ? "Opening…" : "Open"}
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
