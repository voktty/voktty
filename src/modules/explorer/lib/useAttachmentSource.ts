import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { FileAttachmentHandler } from "@/modules/ai/lib/fileAttachmentRequest";
import type { WorkspaceEnv } from "@/modules/workspace";

export type AttachmentSource = {
  workspace: WorkspaceEnv;
  isCurrent: () => boolean;
};

export function useAttachmentSource(
  scope: object,
  workspace: WorkspaceEnv,
  send: FileAttachmentHandler | undefined,
) {
  const filesystem = JSON.stringify(workspace);
  const binding = useMemo(
    () => ({ scope, filesystem, send }),
    [scope, filesystem, send],
  );
  const committed = useRef<{
    binding: typeof binding;
    active: boolean;
    workspace: WorkspaceEnv;
  } | null>(null);
  useLayoutEffect(() => {
    const owner = {
      binding,
      active: true,
      workspace: JSON.parse(filesystem) as WorkspaceEnv,
    };
    committed.current = owner;
    return () => {
      owner.active = false;
      if (committed.current === owner) committed.current = null;
    };
  }, [binding, filesystem]);
  const capture = useCallback((): AttachmentSource | null => {
    const owner = committed.current;
    if (!owner?.active || owner.binding !== binding) return null;
    return {
      workspace: structuredClone(owner.workspace),
      isCurrent: () => owner.active,
    };
  }, [binding]);
  const attach = useCallback(
    (path: string) => {
      const source = capture();
      if (source && send) send(path, source.workspace, source.isCurrent);
    },
    [capture, send],
  );
  return { capture, attach };
}
