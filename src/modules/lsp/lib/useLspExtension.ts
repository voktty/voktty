import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceTextEditRequest } from "@/modules/workspace-edit";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { Extension } from "@codemirror/state";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { serverForLanguage } from "@/modules/lsp/lib/presets";
import { useLspRuntimeStore } from "@/modules/lsp/lib/runtimeStore";
import {
  acquireDocExtension,
  type LspDocHandle,
} from "@/modules/lsp/lib/sessionManager";
import { isLocalLspDocument } from "@/modules/lsp/lib/documentFilesystem";

export function useLspExtension(
  path: string,
  langId: string | null,
  ready: boolean,
  workspace: WorkspaceEnv,
  onWorkspaceEdit?: (request: WorkspaceTextEditRequest) => void,
): Extension | null {
  const customServers = usePreferencesStore((s) => s.lspCustomServers);
  const lspActivation = usePreferencesStore((s) => s.lspActivation);
  const semanticTokens = usePreferencesStore(
    (s) => s.editorSemanticHighlighting,
  );
  const inlayHints = usePreferencesStore((s) => s.editorInlayHints);
  const preset = serverForLanguage(langId, customServers, lspActivation);
  const activation = preset ? lspActivation[preset.id] : undefined;
  const generation = useLspRuntimeStore((s) =>
    preset ? (s.generations[preset.id] ?? 0) : 0,
  );
  const presetId = preset?.id;
  const source = useMemo(
    () => ({
      path,
      langId,
      ready,
      workspace: structuredClone(workspace),
      onWorkspaceEdit,
      activation,
      generation,
      presetId,
      semanticTokens,
      inlayHints,
    }),
    [
      path,
      langId,
      ready,
      workspace,
      onWorkspaceEdit,
      activation,
      generation,
      presetId,
      semanticTokens,
      inlayHints,
    ],
  );
  type Owner = { source: typeof source };
  const ownerRef = useRef<Owner | null>(null);
  const [publication, setPublication] = useState<{
    owner: Owner;
    extension: Extension;
  }>();
  useLayoutEffect(() => {
    const owner = { source };
    ownerRef.current = owner;
    return () => {
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [source]);
  useEffect(() => {
    const owner = ownerRef.current;
    if (
      !owner ||
      owner.source !== source ||
      !source.ready ||
      !source.langId ||
      source.activation !== "enabled" ||
      !isLocalLspDocument(source.path, source.workspace)
    )
      return;
    let active = true;
    let handle: LspDocHandle | null = null;
    const current = () => active && ownerRef.current === owner;
    void acquireDocExtension(
      source.path,
      source.langId,
      source.workspace,
      source.onWorkspaceEdit
        ? (request) => {
            if (current()) source.onWorkspaceEdit?.(request);
          }
        : undefined,
      { semanticTokens: source.semanticTokens, inlayHints: source.inlayHints },
      current,
    )
      .then((h) => {
        if (!h) return;
        if (!current()) {
          h.release();
          return;
        }
        handle = h;
        setPublication((previous) =>
          current() ? { owner, extension: h.extension } : previous,
        );
      })
      .catch(() => {});
    return () => {
      active = false;
      handle?.release();
    };
  }, [source]);
  return publication &&
    publication.owner.source === source &&
    ownerRef.current === publication.owner
    ? publication.extension
    : null;
}
