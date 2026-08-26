import {
  initialBootIntent,
  type LaunchRequest,
  launchRequestCwd,
} from "@/lib/launchRequest";

export type SpacesBootPlan = {
  restoreLastCleanSession: boolean;
  root: string | null;
  createTerminal: boolean;
};

export function planSpacesBoot(
  request: LaunchRequest | null,
  launchCwd: string | null,
  home: string | null,
): SpacesBootPlan {
  const intent = initialBootIntent(request);
  return {
    restoreLastCleanSession: intent === "restoreLastSession",
    root: launchRequestCwd(request) ?? launchCwd ?? home ?? null,
    createTerminal:
      intent === "openDirectoryOnly" || intent === "restoreLastSession",
  };
}
