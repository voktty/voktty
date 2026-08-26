import type { LaunchRequest } from "@/lib/launchRequest";
import { describe, expect, it } from "vitest";
import { planSpacesBoot } from "./bootPlan";

function request(
  intent: LaunchRequest["intent"],
  paths: string[] = [],
): LaunchRequest {
  return {
    requestId: intent,
    source: "coldStart",
    intent,
    paths,
    sourceCwd: "/origin",
  };
}

describe("spaces boot plan", () => {
  it("is the only boot mode that reads the last clean session", () => {
    expect(
      planSpacesBoot(request("restoreLastSession"), "/cwd", "/home"),
    ).toMatchObject({ restoreLastCleanSession: true });
    expect(
      planSpacesBoot(request("openFilesOnly", ["/repo/a.ts"]), "/cwd", "/home"),
    ).toMatchObject({ restoreLastCleanSession: false, createTerminal: false });
    expect(
      planSpacesBoot(request("openDirectoryOnly", ["/repo"]), "/cwd", "/home"),
    ).toMatchObject({
      restoreLastCleanSession: false,
      root: "/repo",
      createTerminal: true,
    });
  });
});
