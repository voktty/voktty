import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortQuit,
  confirmAndCloseWindow,
  handleQuitRequested,
  isAppQuitting,
  setQuitWorkspace,
  type HarnessQuitCapture,
} from "@/modules/harness/lib/appLifecycle";
import { newTab } from "@/modules/harness/lib/layout";
import { newSession } from "@/modules/harness/lib/session";
import {
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  upsertSessions,
} from "@/modules/harness/lib/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/modules/harness/lib/sessionStore", () => ({
  getSession: vi.fn(),
  listInFlightSessions: vi.fn().mockResolvedValue([]),
  loadWorkspaceSnapshot: vi.fn().mockResolvedValue(null),
  replaceInFlightSessions: vi.fn().mockResolvedValue(undefined),
  saveWorkspaceSnapshot: vi.fn().mockResolvedValue(undefined),
  upsertSessions: vi.fn().mockResolvedValue([]),
}));

function capture(cwd: string, busy = true): HarnessQuitCapture {
  const session = newSession("cursor", cwd);
  session.busy = busy;
  session.title = cwd;
  session.blocks = [{ id: "user", role: "user", text: "continue" }];
  const tab = newTab(session.id);
  return {
    sessions: [session],
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: cwd,
    projectReturnMemory: new Map([[cwd, session.id]]),
    projectTerminals: [
      {
        projectPath: cwd,
        pane: {
          id: `dock-${session.id}`,
          activeFileId: `terminal-${session.id}`,
          files: [
            {
              id: `terminal-${session.id}`,
              path: "Terminal",
              cwd,
              terminal: true,
            },
          ],
        },
        side: "bottom",
        size: 240,
        open: true,
      },
    ],
  };
}

function register(get: () => HarnessQuitCapture, flush = vi.fn()) {
  return setQuitWorkspace(
    () => get().sessions,
    () => get().tabs,
    () => get().activeTabId,
    () => get().projectCwd,
    () => get().projectTerminals,
    () => get().projectReturnMemory,
    flush,
    (tab) => get().keepTab?.(tab) ?? true,
  );
}

function close(
  initial: HarnessQuitCapture,
  recapture: () => HarnessQuitCapture | null,
) {
  return confirmAndCloseWindow(
    initial.sessions,
    initial.tabs,
    initial.activeTabId,
    initial.projectCwd,
    initial.projectReturnMemory,
    initial.projectTerminals,
    undefined,
    initial.keepTab,
    recapture,
  );
}

function expectPersisted(current: HarnessQuitCapture) {
  expect(upsertSessions).toHaveBeenCalledWith([
    expect.objectContaining({
      id: current.sessions[0].id,
      title: current.sessions[0].title,
    }),
  ]);
  expect(saveWorkspaceSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      activeTabId: current.activeTabId,
      projectCwd: current.projectCwd,
      sessions: [expect.objectContaining({ id: current.sessions[0].id })],
      projectTerminals: current.projectTerminals,
      projectReturnTargets: [
        { projectPath: current.projectCwd, tabId: current.sessions[0].id },
      ],
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ask).mockResolvedValue(true);
  abortQuit();
});

describe("window close authoritative capture", () => {
  it.each([false, true])(
    "never invokes legacy flush with authoritative reader (accepted=%s)",
    async (accepted) => {
      const initial = capture("/work/initial");
      const legacyFlush = vi.fn();
      const reader = vi.fn(() => (accepted ? initial : null));
      await confirmAndCloseWindow(
        initial.sessions,
        initial.tabs,
        initial.activeTabId,
        initial.projectCwd,
        initial.projectReturnMemory,
        initial.projectTerminals,
        legacyFlush,
        undefined,
        reader,
      );
      expect(reader).toHaveBeenCalledTimes(1);
      expect(legacyFlush).not.toHaveBeenCalled();
      if (accepted) {
        expectPersisted(initial);
        expect(invoke).toHaveBeenCalledWith("destroy_window");
      } else {
        expect(upsertSessions).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
      }
    },
  );

  it("does not destroy the window or use stale data when recapture throws", async () => {
    const error = new Error("capture failed");
    await expect(
      close(capture("/work/initial"), () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(upsertSessions).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("persists a newly completed transcript without marking it interrupted", async () => {
    const current = capture("/work/current", false);
    await close(capture("/work/initial"), () => current);
    expect(upsertSessions).toHaveBeenCalledWith(current.sessions);
    // Unload intentionally preserves old resume refs when no turn remains in flight.
    expect(replaceInFlightSessions).not.toHaveBeenCalled();
  });
  it("persists the capture obtained after confirming, not the dialog input", async () => {
    const initial = capture("/work/initial");
    const current = capture("/work/current");
    const recapture = vi.fn(() => current);
    vi.mocked(ask).mockImplementationOnce(async () => {
      expect(recapture).not.toHaveBeenCalled();
      return true;
    });
    await close(initial, recapture);
    expectPersisted(current);
    expect(replaceInFlightSessions).toHaveBeenCalledWith([
      { sessionId: current.sessions[0].id, cwd: current.projectCwd },
    ]);
    expect(recapture).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("destroy_window");
  });

  it("does not persist or destroy when the captured close owner retired", async () => {
    await close(capture("/work/initial"), () => null);
    expect(upsertSessions).not.toHaveBeenCalled();
    expect(saveWorkspaceSnapshot).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("destroy_window");
  });

  it("does not read or flush a capture when confirmation is declined", async () => {
    vi.mocked(ask).mockResolvedValueOnce(false);
    const recapture = vi.fn(() => capture("/work/current"));
    await close(capture("/work/initial"), recapture);
    expect(recapture).not.toHaveBeenCalled();
    expect(upsertSessions).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("recaptures even on the no-dialog idle path", async () => {
    const current = capture("/work/current", false);
    await close(capture("/work/initial", false), () => current);
    expectPersisted(current);
    expect(ask).not.toHaveBeenCalled();
  });

  it("uses the current keep-tab policy instead of the dialog input policy", async () => {
    const initial = capture("/work/initial");
    initial.keepTab = () => false;
    const current = capture("/work/current");
    current.keepTab = () => true;
    await close(initial, () => current);
    expect(saveWorkspaceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ tabs: current.tabs }),
    );
  });
});

describe("quit request authoritative registered owner", () => {
  it.each(["memory", "terminals"])(
    "vetoes retirement from the final %s getter",
    async (field) => {
      const initial = capture("/work/original");
      let confirmed = false;
      let release = () => {};
      release = setQuitWorkspace(
        () => initial.sessions,
        () => initial.tabs,
        () => initial.activeTabId,
        () => initial.projectCwd,
        () => {
          if (confirmed && field === "terminals") release();
          return initial.projectTerminals;
        },
        () => {
          if (confirmed && field === "memory") release();
          return initial.projectReturnMemory;
        },
        vi.fn(),
      );
      vi.mocked(ask).mockImplementationOnce(async () => {
        confirmed = true;
        return true;
      });
      try {
        await handleQuitRequested();
        expect(upsertSessions).not.toHaveBeenCalled();
        expect(saveWorkspaceSnapshot).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
        expect(isAppQuitting()).toBe(false);
      } finally {
        release();
      }
    },
  );
  it("does not enter the dialog when the initial flush retires its owner", async () => {
    const initial = capture("/work/original");
    let release = () => {};
    release = register(
      () => initial,
      vi.fn(() => release()),
    );
    try {
      await handleQuitRequested();
      expect(ask).not.toHaveBeenCalled();
      expect(upsertSessions).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it("keeps the healthy idle quit path and captures after its final flush", async () => {
    const initial = capture("/work/initial", false);
    const current = capture("/work/current", false);
    let value = initial;
    const flush = vi.fn(() => {
      if (flush.mock.calls.length === 2) value = current;
    });
    const release = register(() => value, flush);
    try {
      await handleQuitRequested();
      expectPersisted(current);
      expect(ask).not.toHaveBeenCalled();
      expect(replaceInFlightSessions).toHaveBeenCalledWith([]);
      expect(invoke).toHaveBeenCalledWith("confirm_quit");
    } finally {
      release();
    }
  });
  it("flushes and recaptures all fields after the dialog", async () => {
    const initial = capture("/work/initial");
    const current = capture("/work/current");
    let value = initial;
    let confirmed = false;
    const flush = vi.fn(() => {
      if (confirmed) value = current;
    });
    const release = register(() => value, flush);
    vi.mocked(ask).mockImplementationOnce(async () => {
      confirmed = true;
      return true;
    });
    try {
      await handleQuitRequested();
      expectPersisted(current);
      expect(flush).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenCalledWith("confirm_quit");
    } finally {
      release();
    }
  });

  it("does not adopt a replacement registered during the dialog", async () => {
    const original = capture("/work/original");
    const replacement = capture("/work/replacement");
    const originalFlush = vi.fn();
    const replacementFlush = vi.fn();
    const releaseOriginal = register(() => original, originalFlush);
    let releaseReplacement = () => {};
    vi.mocked(ask).mockImplementationOnce(async () => {
      releaseReplacement = register(() => replacement, replacementFlush);
      return true;
    });
    try {
      await handleQuitRequested();
      expect(upsertSessions).not.toHaveBeenCalled();
      expect(originalFlush).toHaveBeenCalledTimes(1);
      expect(replacementFlush).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith("confirm_quit");
      expect(isAppQuitting()).toBe(false);
    } finally {
      releaseOriginal();
      releaseReplacement();
    }
  });

  it("does not commit an owner released during the dialog", async () => {
    const initial = capture("/work/original");
    const flush = vi.fn();
    const release = register(() => initial, flush);
    vi.mocked(ask).mockImplementationOnce(async () => {
      release();
      return true;
    });
    await handleQuitRequested();
    expect(upsertSessions).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("confirm_quit");
    expect(isAppQuitting()).toBe(false);
  });

  it("revalidates registration after a reentrant final flush", async () => {
    const initial = capture("/work/original");
    let confirmed = false;
    let release = () => {};
    const flush = vi.fn(() => {
      if (confirmed) release();
    });
    release = register(() => initial, flush);
    vi.mocked(ask).mockImplementationOnce(async () => {
      confirmed = true;
      return true;
    });
    try {
      await handleQuitRequested();
      expect(flush).toHaveBeenCalledTimes(2);
      expect(upsertSessions).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith("confirm_quit");
      expect(isAppQuitting()).toBe(false);
    } finally {
      release();
    }
  });

  it("does not recapture or commit when the user declines quit", async () => {
    const initial = capture("/work/original");
    const flush = vi.fn();
    const release = register(() => initial, flush);
    vi.mocked(ask).mockResolvedValueOnce(false);
    try {
      await handleQuitRequested();
      expect(flush).toHaveBeenCalledTimes(1);
      expect(upsertSessions).not.toHaveBeenCalled();
      expect(isAppQuitting()).toBe(false);
    } finally {
      release();
    }
  });
});
