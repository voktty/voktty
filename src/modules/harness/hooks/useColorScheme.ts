import { useTheme } from "@/modules/theme";
import type { ColorScheme } from "../lib/appearance";

/** Mirrors Voktty's own resolved theme mode - the harness has no color
 * scheme of its own, see `lib/appearance.ts#isLightScheme`. */
export function useColorScheme(): ColorScheme {
  return useTheme().resolvedMode;
}
