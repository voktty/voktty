import { resolveLanguage } from "@/modules/editor/lib/languageResolver";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceEnv } from "@/modules/workspace";
import { isLocalLspDocument } from "@/modules/lsp/lib/documentFilesystem";
import { useEffect, useState } from "react";
import { detectBinary } from "./detect";
import { type LspPreset, serverForLanguage } from "./presets";
import { type LspSessionStatus, useLspRuntimeStore } from "./runtimeStore";

export type LspHint =
  | { kind: "unsupported"; preset: LspPreset }
  | { kind: "enable"; preset: LspPreset }
  | { kind: "install"; preset: LspPreset }
  | { kind: "active"; preset: LspPreset; status: LspSessionStatus }
  | { kind: "error"; preset: LspPreset; reason: string };

export function useLspHint(
  filePath: string | null,
  workspace: WorkspaceEnv | undefined,
): LspHint | null {
  const [resolved, setResolved] = useState<{
    path: string;
    id: string | null;
  }>();
  const supported = isLocalLspDocument(filePath, workspace);
  const ext = filePath?.split(".").pop()?.toLowerCase() ?? null;
  const langId = resolved?.path === filePath ? resolved.id : ext;

  useEffect(() => {
    if (!filePath || !supported) return;
    let cancelled = false;
    void resolveLanguage(filePath).then((result) => {
      if (cancelled) return;
      const ext = filePath.split(".").pop()?.toLowerCase() ?? null;
      setResolved({ path: filePath, id: result?.id || ext });
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, supported]);

  const customServers = usePreferencesStore((s) => s.lspCustomServers);
  const lspActivation = usePreferencesStore((s) => s.lspActivation);
  const preset = serverForLanguage(langId, customServers, lspActivation);
  const activation = preset ? lspActivation[preset.id] : undefined;
  const detected = useLspRuntimeStore((s) =>
    preset ? s.detected[preset.command] : undefined,
  );
  const session = useLspRuntimeStore((s) =>
    preset
      ? Object.values(s.sessions).find((x) => x.presetId === preset.id)
      : undefined,
  );
  const failure = useLspRuntimeStore((s) =>
    preset ? s.failed[preset.id] : undefined,
  );

  useEffect(() => {
    if (preset && supported && activation === undefined) {
      void detectBinary(preset.command);
    }
  }, [preset, supported, activation]);

  if (!preset) return null;
  if (!supported) return { kind: "unsupported", preset };
  if (activation === "dismissed") return null;
  if (activation === "enabled") {
    if (session) return { kind: "active", preset, status: session.status };
    if (failure) return { kind: "error", preset, reason: failure };
    return null;
  }
  if (detected === undefined) return null;
  return detected ? { kind: "enable", preset } : { kind: "install", preset };
}
