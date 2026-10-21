import type { LaunchRequest } from "@/lib/launchRequest";
import { describe, expect, it } from "vitest";
import {
  hydratePersistedSpaceTabs,
  missingStartupHarnessTabs,
  planSpacesBoot,
} from "./bootPlan";
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
  it("defaults ordinary cold starts to Harness without a terminal", () => {
    expect(planSpacesBoot(null, "/cwd", "/home")).toEqual({
      restoreLastCleanSession: true,
      root: "/cwd",
      createHarness: true,
      createTerminal: false,
    });
    expect(planSpacesBoot(null, null, "/home").root).toBe("/home");
  });

  it("keeps explicit terminal startup behavior for empty and directory launches", () => {
    expect(planSpacesBoot(null, "/cwd", "/home", "terminal")).toMatchObject({
      createHarness: false,
      createTerminal: true,
    });
    expect(
      planSpacesBoot(
        request("openDirectoryOnly", ["C:\\repo"]),
        null,
        null,
        "terminal",
      ),
    ).toMatchObject({
      root: "C:/repo",
      createHarness: false,
      createTerminal: true,
    });
  });

  it.each([
    "openFilesOnly",
    "openFilesInCurrentSession",
    "openDirectoryInCurrentSession",
    "newStandaloneTab",
  ] as const)("does not autoboot Harness for %s requests", (intent) => {
    expect(planSpacesBoot(request(intent), "/cwd", "/home")).toMatchObject({
      restoreLastCleanSession: false,
      createHarness: false,
      createTerminal: false,
    });
  });
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
      createTerminal: false,
      createHarness: true,
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

describe("startup Harness migration scope", () => {
  it("only seeds local roots or an existing explicit remote project descriptor", () => {
    const base = {
      id: "project",
      name: "Project",
      root: "/repo",
      createdAt: 1,
      updatedAt: 1,
    };
    const spaces: SpaceMeta[] = [
      {
        ...base,
        id: "local",
        root: "//server/share/repo",
        env: { kind: "local" },
      },
      { ...base, id: "wsl", env: { kind: "wsl", distro: "Ubuntu" } },
      {
        ...base,
        id: "ssh",
        env: {
          kind: "ssh",
          root: "/repo",
          connection: { id: "ssh", name: "SSH", host: "host.test" },
        },
      },
      {
        ...base,
        id: "docker",
        env: {
          kind: "docker",
          connection: {
            containerId: "container",
            containerName: "Container",
            image: "image",
          },
        },
      },
      {
        ...base,
        id: "serial",
        env: { kind: "serial", portName: "COM3", baudRate: 9600 },
      },
      {
        ...base,
        id: "remote",
        root: "remote://ssh-project/repo",
        env: { kind: "local" },
      },
    ];
    let id = 0;
    const tabs = missingStartupHarnessTabs(spaces, [], () => ++id);
    expect(tabs.map((tab) => tab.cwd)).toEqual([
      "//server/share/repo",
      undefined,
      undefined,
      undefined,
      undefined,
      "remote://ssh-project/repo",
    ]);
    expect(id).toBe(6);
  });
});
