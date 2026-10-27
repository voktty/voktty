import { afterEach, describe, expect, it } from "vitest";
import { NO_SURFACE } from "./activeSurface";
import {
  publishActiveSurface,
  useActiveSurfaceStore,
} from "./activeSurfaceStore";
import {
  publishHarnessProject,
  useHarnessSurfaceStore,
} from "./harnessSurfaceStore";

afterEach(() => {
  publishActiveSurface(null);
  useHarnessSurfaceStore.setState({
    reports: {},
  });
});

describe("selected active surface", () => {
  it("publishes the selected owner's complete context for readers", () => {
    publishActiveSurface({
      kind: "harness",
      ownerId: 1,
      projectCwd: "remote://machine-a/srv/app",
      focusFolder: "remote://machine-a/srv/app/src",
    });
    expect(useActiveSurfaceStore.getState().surface).toEqual({
      kind: "harness",
      ownerId: 1,
      project: "remote://machine-a/srv/app",
      folder: "remote://machine-a/srv/app/src",
      environment: { kind: "remote", environmentId: "machine-a" },
    });
  });

  it("does not change selection when an inactive Harness reports a folder", () => {
    publishActiveSurface({ kind: "terminal", ownerId: 1, cwd: "/terminal" });
    const selected = useActiveSurfaceStore.getState().surface;
    publishHarnessProject("/background", 2);
    expect(useActiveSurfaceStore.getState().surface).toBe(selected);
  });

  it("clears the surface when nothing is selected", () => {
    publishActiveSurface({ kind: "editor", ownerId: 1, folder: "/explorer" });
    publishActiveSurface(null);
    expect(useActiveSurfaceStore.getState().surface).toBe(NO_SURFACE);
  });
});
