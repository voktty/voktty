import type { LaunchRequest } from "@/lib/launchRequest";

export function shouldSkipBootDirectoryLaunchRequest(
  request: LaunchRequest,
  wasDirectoryRequestAppliedAtBoot: (requestId: string) => boolean,
): boolean {
  return (
    request.intent === "openDirectoryOnly" &&
    (request.source === "coldStart" ||
      wasDirectoryRequestAppliedAtBoot(request.requestId))
  );
}
