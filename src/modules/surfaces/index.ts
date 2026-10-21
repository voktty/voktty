export {
  NO_SURFACE,
  resolveActiveSurface,
  type ActiveSurface,
  type ActiveSurfaceInput,
  type SurfaceEnvironment,
  type SurfaceKind,
} from "./lib/activeSurface";
export { coerceCwd, firstCwd } from "./lib/cwd";
export {
  publishActiveSurface,
  useActiveSurfaceStore,
} from "./lib/activeSurfaceStore";
export {
  installLegacyHarnessSurfaceEvents,
  publishHarnessFocusFolder,
  publishHarnessProject,
  removeHarnessSurface,
  selectHarnessSurface,
  useHarnessSurfaceStore,
  type HarnessSurfaceReport,
} from "./lib/harnessSurfaceStore";
