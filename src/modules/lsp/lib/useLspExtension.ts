import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceTextEditRequest } from "@/modules/workspace-edit";
import type { Extension } from "@codemirror/state";
import { useCallback, useEffect, useRef, useState } from "react";
import { serverForLanguage } from "./presets";
import { useLspRuntimeStore } from "./runtimeStore";
import { acquireDocExtension, type LspDocHandle } from "./sessionManager";

export function useLspExtension(
  path: string,
  langId: string | null,
  ready: boolean,
  onWorkspaceEdit?: (request: WorkspaceTextEditRequest) => void,
): Extension | null {
  const [ext, setExt] = useState<Extension | null>(null);
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
  const workspaceEditRef = useRef(onWorkspaceEdit);
  workspaceEditRef.current = onWorkspaceEdit;
  const forwardWorkspaceEdit = useCallback(
    (request: WorkspaceTextEditRequest) => workspaceEditRef.current?.(request),
    [],
  );

  const presetId = preset?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies(generation): re-acquire after a server crash tears the session down
  // biome-ignore lint/correctness/useExhaustiveDependencies(presetId): swapping the enabled server for a language must rebind the doc
  useEffect(() => {
    if (!ready || !langId || activation !== "enabled") {
      setExt(null);
      return;
    }
    let cancelled = false;
    let handle: LspDocHandle | null = null;
    acquireDocExtension(path, langId, forwardWorkspaceEdit, {
      semanticTokens,
      inlayHints,
    })
      .then((h) => {
        if (!h) return;
        if (cancelled) {
          h.release();
          return;
        }
        handle = h;
        setExt(h.extension);
      })
      .catch((e) => console.error("[lsp] acquire failed", e));
    return () => {
      cancelled = true;
      handle?.release();
      setExt(null);
    };
  }, [
    path,
    langId,
    ready,
    activation,
    generation,
    presetId,
    forwardWorkspaceEdit,
    semanticTokens,
    inlayHints,
  ]);

  return ext;
}
