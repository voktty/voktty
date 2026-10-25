import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { remoteProjectForPath } from "@/modules/connections/model/remoteProjects";
import {
  isPathInRemoteWorkspace,
  remoteReadBinaryFile,
} from "@/modules/remote";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  isWindowsNativePath,
  type WorkspaceEnv,
  workspaceForDocumentPath,
  workspaceForNativeFs,
} from "@/modules/workspace";

let pendingReads = 0;
const MAX_PENDING_READS = 256;

export function useMediaSource(
  path: string | undefined,
  workspaceEnv: WorkspaceEnv,
  mime: string,
) {
  const source = useMemo(() => {
    const namespace =
      path?.replace(/\\/g, "/").startsWith("remote://") ?? false;
    const workspace = workspaceForDocumentPath(workspaceEnv, path ?? "");
    return {
      path,
      mime,
      namespace,
      workspace:
        workspace.kind === "ssh"
          ? { ...workspace, connection: { ...workspace.connection } }
          : { ...workspace },
      supported:
        namespace ||
        (workspaceEnv.kind !== "docker" && workspaceEnv.kind !== "serial") ||
        isWindowsNativePath(path ?? ""),
      project: namespace ? remoteProjectForPath(path ?? "") : undefined,
      profiles: namespace
        ? (usePreferencesStore.getState().sshConnections ?? []).map(
            (profile) => ({ ...profile }),
          )
        : [],
    };
  }, [path, workspaceEnv, mime]);
  type Owner = {
    source: typeof source;
    active: boolean;
    pending: boolean;
    url?: string;
  };
  const ownerRef = useRef<Owner | null>(null);
  const [display, setDisplay] = useState<{
    owner: Owner;
    src?: string;
    failed: boolean;
  }>();
  const publicationRef = useRef<typeof display>(undefined);
  const publish = useCallback((next: NonNullable<typeof display>) => {
    publicationRef.current = next;
    setDisplay(next);
  }, []);

  useLayoutEffect(() => {
    const owner: Owner = { source, active: true, pending: false };
    ownerRef.current = owner;
    return () => {
      owner.active = false;
      if (ownerRef.current === owner) ownerRef.current = null;
      if (owner.url) URL.revokeObjectURL(owner.url);
    };
  }, [source]);

  const load = useCallback(
    async (owner: Owner) => {
      const current = () => owner.active && ownerRef.current === owner;
      if (!current() || owner.pending || !source.path) return;
      if (pendingReads >= MAX_PENDING_READS) {
        publish({ owner, failed: true });
        return;
      }
      owner.pending = true;
      pendingReads++;
      try {
        if (!source.supported) throw new Error("Unsupported media filesystem.");
        let bytes: Uint8Array;
        if (source.namespace) {
          const { createProjectDocument, assertProjectDocumentCurrent } =
            await import("@/modules/remote/projectDocument");
          assertProjectDocumentCurrent(current);
          const io = createProjectDocument(
            source.path,
            source.project,
            source.profiles,
          );
          bytes = (await io.readBinary(current)).bytes;
        } else if (isPathInRemoteWorkspace(source.workspace, source.path)) {
          bytes = (await remoteReadBinaryFile(source.workspace, source.path))
            .bytes;
        } else {
          const raw = await invoke<number[] | Uint8Array>(
            "fs_read_binary_file",
            {
              path: source.path,
              workspace: workspaceForNativeFs(source.workspace, source.path),
            },
          );
          bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        }
        if (!current()) return;
        const content = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const url = URL.createObjectURL(
          new Blob([content], { type: source.mime }),
        );
        if (!current()) {
          URL.revokeObjectURL(url);
          return;
        }
        if (owner.url) URL.revokeObjectURL(owner.url);
        owner.url = url;
        publish({ owner, src: url, failed: false });
      } catch {
        if (current()) publish({ owner, failed: true });
      } finally {
        owner.pending = false;
        pendingReads--;
      }
    },
    [source, publish],
  );

  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner || owner.source !== source || !source.path) return;
    if (
      source.supported &&
      !source.namespace &&
      source.workspace.kind === "local"
    ) {
      try {
        publish({ owner, src: convertFileSrc(source.path), failed: false });
      } catch {
        void load(owner);
      }
    } else {
      void load(owner);
    }
  }, [source, load, publish]);

  const owner = display?.owner;
  const isCurrent = () =>
    !!owner &&
    owner.source === source &&
    owner.active &&
    ownerRef.current === owner &&
    publicationRef.current === display;
  return {
    src: isCurrent() ? display?.src : undefined,
    failed: isCurrent() ? (display?.failed ?? false) : false,
    isCurrent,
    retry: () => {
      if (isCurrent() && owner) void load(owner);
    },
    onError: () => {
      if (!isCurrent() || !owner) return;
      if (owner.url) publish({ owner, failed: true });
      else void load(owner);
    },
  };
}
