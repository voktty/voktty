// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HARNESS_CWD_CHANGE_EVENT,
  HARNESS_FOCUS_FOLDER_EVENT,
  installLegacyHarnessSurfaceEvents,
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
    projectCwd: null,
    focusFolder: null,
    reports: {},
  });
});

const report = (ownerId: number) =>
  selectHarnessSurface(useHarnessSurfaceStore.getState(), ownerId);

describe("harness surface store", () => {
  it("stores legacy project and focus folders", () => {
    publishHarnessProject("C:/repo");
    publishHarnessFocusFolder("C:/repo/src");
    expect(useHarnessSurfaceStore.getState()).toMatchObject({
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
    expect(useHarnessSurfaceStore.getState().projectCwd).toBeNull();
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

  it("never lets an owned view adopt an ownerless legacy report", () => {
    publishHarnessProject("/legacy");
    expect(report(1).projectCwd).toBeNull();
    expect(
      selectHarnessSurface(useHarnessSurfaceStore.getState(), undefined)
        .projectCwd,
    ).toBe("/legacy");
    publishHarnessProject("/owned", 1);
    publishHarnessProject("/new-legacy");
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

describe("legacy event adapter", () => {
  it("routes incoming events until it is uninstalled", () => {
    const uninstall = installLegacyHarnessSurfaceEvents();
    cleanups.push(uninstall);
    window.dispatchEvent(
      new CustomEvent(HARNESS_CWD_CHANGE_EVENT, { detail: { cwd: "/a" } }),
    );
    window.dispatchEvent(
      new CustomEvent(HARNESS_FOCUS_FOLDER_EVENT, { detail: { cwd: "/a/b" } }),
    );
    expect(useHarnessSurfaceStore.getState()).toMatchObject({
      projectCwd: "/a",
      focusFolder: "/a/b",
    });
    uninstall();
    window.dispatchEvent(
      new CustomEvent(HARNESS_CWD_CHANGE_EVENT, { detail: { cwd: "/z" } }),
    );
    expect(useHarnessSurfaceStore.getState().projectCwd).toBe("/a");
  });

  it("notifies old listeners once without republishing incoming events", () => {
    cleanups.push(installLegacyHarnessSurfaceEvents());
    const listener = vi.fn();
    window.addEventListener(HARNESS_CWD_CHANGE_EVENT, listener);
    cleanups.push(() =>
      window.removeEventListener(HARNESS_CWD_CHANGE_EVENT, listener),
    );
    const storeListener = vi.fn();
    cleanups.push(useHarnessSurfaceStore.subscribe(storeListener));
    publishHarnessProject("/project", 2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storeListener).toHaveBeenCalledTimes(1);
    expect(report(2).projectCwd).toBe("/project");
    expect(useHarnessSurfaceStore.getState().projectCwd).toBeNull();
  });

  it("routes a scoped legacy event only to that owner", () => {
    cleanups.push(installLegacyHarnessSurfaceEvents());
    window.dispatchEvent(
      new CustomEvent(HARNESS_FOCUS_FOLDER_EVENT, {
        detail: { cwd: "/scoped", ownerId: 2 },
      }),
    );
    expect(report(2).focusFolder).toBe("/scoped");
    expect(report(1).focusFolder).toBeNull();
  });

  it("rejects malformed event details and invalid owners", () => {
    cleanups.push(installLegacyHarnessSurfaceEvents());
    for (const detail of [
      { cwd: {} },
      { cwd: "/bad-owner", ownerId: "2" },
      undefined,
    ]) {
      window.dispatchEvent(
        new CustomEvent(HARNESS_FOCUS_FOLDER_EVENT, { detail }),
      );
    }
    expect(useHarnessSurfaceStore.getState().focusFolder).toBeNull();
    expect(useHarnessSurfaceStore.getState().reports).toEqual({});
  });
});
