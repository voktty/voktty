import { describe, expect, it } from "vitest";
import { nextVisibleRoot } from "./visibleRoot";

describe("nextVisibleRoot", () => {
  it("follows a cwd change in the active terminal", () => {
    expect(
      nextVisibleRoot({
        currentVisibleRoot: "C:/repo",
        previousSourceRoot: "C:/repo",
        sourceRoot: "C:/repo/packages/app",
        navigationChanged: false,
        sourceReachable: true,
        workspaceRoot: null,
      }),
    ).toBe("C:/repo/packages/app");
  });

  it("preserves manual parent navigation while the terminal cwd is unchanged", () => {
    expect(
      nextVisibleRoot({
        currentVisibleRoot: "C:/",
        previousSourceRoot: "C:/repo",
        sourceRoot: "C:/repo",
        navigationChanged: false,
        sourceReachable: true,
        workspaceRoot: null,
      }),
    ).toBe("C:/");
  });

  it("resets to the source root when the active navigation context changes", () => {
    expect(
      nextVisibleRoot({
        currentVisibleRoot: "C:/",
        previousSourceRoot: "C:/repo",
        sourceRoot: "D:/other",
        navigationChanged: true,
        sourceReachable: true,
        workspaceRoot: null,
      }),
    ).toBe("D:/other");
  });

  it("preserves remote navigation until an outside cwd is explicitly refreshed", () => {
    expect(
      nextVisibleRoot({
        currentVisibleRoot: "/root",
        previousSourceRoot: "/root",
        sourceRoot: "/opt/data",
        navigationChanged: false,
        sourceReachable: false,
        workspaceRoot: "/root",
      }),
    ).toBe("/root");
  });

  it("uses the remote workspace root for an unreachable cwd in a new context", () => {
    expect(
      nextVisibleRoot({
        currentVisibleRoot: "C:/repo",
        previousSourceRoot: "C:/repo",
        sourceRoot: "/opt/data",
        navigationChanged: true,
        sourceReachable: false,
        workspaceRoot: "/root",
      }),
    ).toBe("/root");
  });
});
