// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishHarnessFocusFolder,
  publishHarnessProject,
  removeHarnessSurface,
  selectHarnessSurface,
  useHarnessSurfaceStore,
} from "./harnessSurfaceStore";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  useHarnessSurfaceStore.setState({
    reports: {},
  });
});

const report = (ownerId: number) =>
  selectHarnessSurface(useHarnessSurfaceStore.getState(), ownerId);

describe("harness surface store", () => {
  it("stores project and focus folders under their explicit owner", () => {
    publishHarnessProject("C:/repo", 1);
    publishHarnessFocusFolder("C:/repo/src", 1);
    expect(report(1)).toEqual({
      projectCwd: "C:/repo",
      focusFolder: "C:/repo/src",
    });
  });

  it("ignores values that are not paths and keeps the previous one", () => {
    publishHarnessProject("C:/repo", 1);
    for (const invalid of [undefined, 7, "   ", {}]) {
      publishHarnessProject(invalid, 1);
      publishHarnessFocusFolder(invalid, 1);
    }
    expect(report(1)).toEqual({ projectCwd: "C:/repo", focusFolder: null });
  });

  it("does not let a background owner replace the selected owner's folders", () => {
    publishHarnessProject("C:/local", 1);
    publishHarnessFocusFolder("C:/local/src", 1);
    publishHarnessProject("remote://ssh-a/srv/app", 2);
    publishHarnessFocusFolder("remote://ssh-a/srv/app/src", 2);
    expect(report(1)).toEqual({
      projectCwd: "C:/local",
      focusFolder: "C:/local/src",
    });
    expect(useHarnessSurfaceStore.getState()).not.toHaveProperty("projectCwd");
  });

  it("restores the other owner's folder on focus switch without a new report", () => {
    publishHarnessProject("/project-a", 1);
    publishHarnessProject("/project-b", 2);
    const state = useHarnessSurfaceStore.getState();
    expect(selectHarnessSurface(state, 1).projectCwd).toBe("/project-a");
    expect(selectHarnessSurface(state, 2).projectCwd).toBe("/project-b");
    expect(selectHarnessSurface(state, 1).projectCwd).toBe("/project-a");
  });

  it("removes only the closed owner", () => {
    publishHarnessProject("/project-a", 1);
    publishHarnessProject("/project-b", 2);
    const otherReport = report(2);
    removeHarnessSurface(1);
    expect(useHarnessSurfaceStore.getState().reports[1]).toBeUndefined();
    expect(report(2)).toBe(otherReport);
    removeHarnessSurface(1);
    expect(report(2)).toBe(otherReport);
  });

  it("returns no report for an absent owner without borrowing another view", () => {
    publishHarnessProject("/owned", 1);
    const state = useHarnessSurfaceStore.getState();
    for (const ownerId of [undefined, null, -1, Number.NaN])
      expect(selectHarnessSurface(state, ownerId)).toEqual({
        projectCwd: null,
        focusFolder: null,
      });
    expect(report(1).projectCwd).toBe("/owned");
    removeHarnessSurface(1);
    expect(report(1).projectCwd).toBeNull();
  });

  it("does not notify store readers for an identical report", () => {
    publishHarnessProject("/project-a", 1);
    const listener = vi.fn();
    cleanups.push(useHarnessSurfaceStore.subscribe(listener));
    publishHarnessProject("/project-a", 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid owner %s",
    (ownerId) => {
      publishHarnessProject("/project", ownerId);
      expect(useHarnessSurfaceStore.getState().reports).toEqual({});
    },
  );
});
