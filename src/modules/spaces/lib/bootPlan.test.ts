import type { LaunchRequest } from "@/lib/launchRequest";
import { describe, expect, it } from "vitest";
import { hydratePersistedSpaceTabs, planSpacesBoot } from "./bootPlan";
import type { SpaceMeta, SpaceState } from "./store";

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

describe("persisted space hydration", () => {
  it("keeps intentionally empty spaces empty while restoring populated ones", () => {
    const spaces: SpaceMeta[] = ["empty", "populated"].map((id) => ({
      id,
      name: id,
      root: null,
      env: { kind: "local" },
      createdAt: 1,
      updatedAt: 1,
    }));
    const states = new Map<string, SpaceState>([
      ["empty", { tabs: [], activeTabIndex: 0 }],
      [
        "populated",
        { tabs: [{ kind: "editor", path: "/repo/a.ts" }], activeTabIndex: 0 },
      ],
    ]);
    let id = 0;
    const tabs = hydratePersistedSpaceTabs(spaces, states, () => ++id);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ spaceId: "populated", kind: "editor" });
  });
});
