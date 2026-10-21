import { create } from "zustand";
import {
  type ActiveSurface,
  type ActiveSurfaceInput,
  NO_SURFACE,
  resolveActiveSurface,
} from "./activeSurface";

type ActiveSurfaceState = { surface: ActiveSurface };

export const useActiveSurfaceStore = create<ActiveSurfaceState>(() => ({
  surface: NO_SURFACE,
}));

// The window coordinator is the only publisher of the selected outer surface.
export function publishActiveSurface(input: ActiveSurfaceInput | null): void {
  useActiveSurfaceStore.setState({ surface: resolveActiveSurface(input) });
}
