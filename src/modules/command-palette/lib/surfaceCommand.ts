import type { ActiveSurface } from "@/modules/surfaces/lib/activeSurface";
import { commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";

export type SurfaceCommand = {
  id: string;
  disabledReason?: string;
  run: () => void;
};

export function surfaceCommandReason(command: SurfaceCommand, surface: ActiveSurface) {
  if (command.disabledReason) return command.disabledReason;
  if (surface.ownerId === null) return undefined;
  const reason = commandSurfaceUnavailableReason(command.id, surface);
  if (reason === "editor-required") return "commandPalette.disabled.noEditorTab";
  if (reason === "terminal-required") return "commandPalette.disabled.noTerminalTab";
  return undefined;
}

export function captureSurfaceCommand(command: SurfaceCommand, readSurface: () => ActiveSurface): (() => void) | null {
  const surface = readSurface();
  if (surfaceCommandReason(command, surface)) return null;
  return () => {
    if (readSurface() !== surface || surfaceCommandReason(command, surface)) return;
    command.run();
  };
}
