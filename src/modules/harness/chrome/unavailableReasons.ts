import { createContext, useContext } from "react";
import type { ProjectUnavailableReason } from "../lib/projectAvailability";
import { sameProjectPath } from "../lib/recents";

export const UnavailableReasonsContext = createContext<
  ReadonlyMap<string, ProjectUnavailableReason>
>(new Map());

export function useUnavailableReason(
  path: string,
): ProjectUnavailableReason | null {
  const reasons = useContext(UnavailableReasonsContext);
  for (const [candidate, reason] of reasons) {
    if (sameProjectPath(candidate, path)) return reason;
  }
  return null;
}

/** i18n keys for the tooltip, accessible name and tag of an unavailable project. */
export function unavailableKeys(reason: ProjectUnavailableReason) {
  switch (reason) {
    case "host-unreachable":
      return {
        titleKey: "harness.unavailableHost",
        shortKey: "harness.unavailableHostShort",
        tagKey: "harness.unavailableHostTag",
      } as const;
    case "profile-missing":
      return {
        titleKey: "harness.unavailableProfile",
        shortKey: "harness.unavailableProfileShort",
        tagKey: "harness.unavailableProfileTag",
      } as const;
    default:
      return {
        titleKey: "harness.unavailableDir",
        shortKey: "harness.unavailableDirShort",
        tagKey: "harness.unavailableDirTag",
      } as const;
  }
}
