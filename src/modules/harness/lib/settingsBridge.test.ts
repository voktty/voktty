import { beforeEach, describe, expect, it } from "vitest";
import {
  publishHarnessSettingsContext,
  useHarnessSettingsBridge,
  type HarnessSettingsContext,
} from "./settingsBridge";

function context(cwd: string): HarnessSettingsContext {
  return {
    cwd,
    recents: [],
    sessions: [],
    onOpenSession: () => {},
    onArchiveSession: () => {},
    onDeleteSession: () => {},
    onRestoreProject: () => {},
    onDeleteProject: () => {},
  };
}

describe("harness settings bridge", () => {
  beforeEach(() => {
    useHarnessSettingsBridge.setState({ owner: null, context: null });
  });

  it("exposes the latest published context", () => {
    publishHarnessSettingsContext(context("/a"), Symbol("a"));
    expect(useHarnessSettingsBridge.getState().context?.cwd).toBe("/a");
  });

  it("ignores a release from a replaced owner", () => {
    const first = Symbol("first");
    const releaseFirst = publishHarnessSettingsContext(context("/a"), first);
    publishHarnessSettingsContext(context("/b"), Symbol("second"));
    releaseFirst();
    expect(useHarnessSettingsBridge.getState().context?.cwd).toBe("/b");
  });

  it("clears the context when the current owner releases", () => {
    const release = publishHarnessSettingsContext(context("/a"), Symbol("a"));
    release();
    expect(useHarnessSettingsBridge.getState().context).toBeNull();
  });
});
