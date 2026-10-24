import { useMemo } from "react";
import { useActiveSurfaceStore } from "@/modules/surfaces/lib/activeSurfaceStore";
import { NO_SURFACE } from "@/modules/surfaces/lib/activeSurface";
import { useTranslation } from "@/modules/i18n";
import { surfaceCommandReason, type SurfaceCommand } from "@/modules/command-palette/lib/surfaceCommand";

export function useSurfaceCommands<T extends SurfaceCommand>(items: readonly T[], enabled: boolean): T[] {
  const surface = useActiveSurfaceStore((state) => enabled ? state.surface : NO_SURFACE);
  const { t } = useTranslation();
  return useMemo(() => items.map((item) => {
    const reason = surfaceCommandReason(item, surface);
    return reason && !item.disabledReason ? { ...item, disabledReason: t(reason) } : item;
  }), [items, surface, t]);
}
