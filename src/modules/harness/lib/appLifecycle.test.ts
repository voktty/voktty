import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  abortQuit,
  askQuitConfirmation,
  commitQuit,
  confirmAndCloseWindow,
  isAppQuitting,
  reportQuitPoll,
  setQuitWorkspace,
} from "./appLifecycle";
import { newTab } from "./layout";
import { newSession, type Session } from "./session";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn().mockResolvedValue(true),
}));

vi.mock("./sessionStore", () => ({
  getSession: vi.fn(),
  listInFlightSessions: vi.fn().mockResolvedValue([]),
  loadWorkspaceSnapshot: vi.fn().mockResolvedValue(null),
  replaceInFlightSessions: vi.fn().mockResolvedValue(undefined),
  saveWorkspaceSnapshot: vi.fn().mockResolvedValue(undefined),
  upsertSessions: vi.fn().mockResolvedValue([]),
}));

function busyChat(cwd: string): Session {
  const session = newSession("cursor", cwd);
  session.busy = true;
  session.blocks = [{ id: "u1", role: "user", text: "hello" }];
  return session;
}

function idleChat(cwd: string): Session {
  const session = newSession("cursor", cwd);
  session.busy = false;
  session.blocks = [{ id: "u1", role: "user", text: "hello" }];
  return session;
}

describe("appLifecycle coordinated quit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abortQuit();
  });

  describe("reportQuitPoll", () => {
    it("reports busy count when live workspace has busy sessions", async () => {
      const session = busyChat("/work/app");
      const tabs = [newTab(session.id)];
      const release = setQuitWorkspace(
        () => [session],
        () => tabs,
        () => tabs[0].id,
        () => "/work/app",
        () => [],
        vi.fn(),
      );

      try {
        await reportQuitPoll(42);
        expect(invoke).toHaveBeenCalledWith("quit_poll_reply", {
          id: 42,
          inFlight: 1,
        });
      } finally {
        release();
      }
    });

    it("reports inFlight 0 when live workspace is idle", async () => {
      const session = idleChat("/work/app");
      const tabs = [newTab(session.id)];
      const release = setQuitWorkspace(
        () => [session],
        () => tabs,
        () => tabs[0].id,
        () => "/work/app",
        () => [],
        vi.fn(),
      );

      try {
        await reportQuitPoll(99);
        expect(invoke).toHaveBeenCalledWith("quit_poll_reply", {
          id: 99,
          inFlight: 0,
        });
      } finally {
        release();
      }
    });
  });

  describe("askQuitConfirmation", () => {
    it("asks user confirmation and reports confirmed decision", async () => {
      vi.mocked(ask).mockResolvedValueOnce(true);

      await askQuitConfirmation({ id: 10, inFlight: 2 });
      expect(ask).toHaveBeenCalledWith(
        expect.stringContaining("2 chats are still running"),
        expect.objectContaining({
          title: "Voktty",
          kind: "warning",
          okLabel: "Quit",
        }),
      );
      expect(invoke).toHaveBeenCalledWith("quit_decision", {
        id: 10,
        confirmed: true,
      });
    });

    it("reports confirmed false when user cancels", async () => {
      vi.mocked(ask).mockResolvedValueOnce(false);

      await askQuitConfirmation({ id: 11, inFlight: 1 });
      expect(invoke).toHaveBeenCalledWith("quit_decision", {
        id: 11,
        confirmed: false,
      });
    });
  });

  describe("commitQuit", () => {
    it("marks app quitting and invokes quit_ready", async () => {
      const session = idleChat("/work/app");
      const tabs = [newTab(session.id)];
      const flush = vi.fn();
      const release = setQuitWorkspace(
        () => [session],
        () => tabs,
        () => tabs[0].id,
        () => "/work/app",
        () => [],
        flush,
      );

      try {
        await commitQuit(77);
        expect(flush).toHaveBeenCalled();
        expect(isAppQuitting()).toBe(true);
        expect(invoke).toHaveBeenCalledWith("quit_ready", {
          id: 77,
          persisted: true,
        });
      } finally {
        release();
      }
    });
  });

  describe("abortQuit", () => {
    it("resets quitting flag to false", async () => {
      abortQuit();
      expect(isAppQuitting()).toBe(false);
    });
  });

  describe("confirmAndCloseWindow", () => {
    it("asks confirmation if busy and closes window on confirmation", async () => {
      vi.mocked(ask).mockResolvedValueOnce(true);
      const session = busyChat("/work/app");
      const tabs = [newTab(session.id)];
      const flush = vi.fn();

      await confirmAndCloseWindow(
        [session],
        tabs,
        tabs[0].id,
        "/work/app",
        [],
        flush,
      );

      expect(ask).toHaveBeenCalledWith(
        expect.stringContaining("1 chat is still running"),
        expect.objectContaining({
          title: "Voktty",
          kind: "warning",
          okLabel: "Close",
        }),
      );
      expect(flush).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("destroy_window");
    });

    it("does not close window when user aborts close confirmation", async () => {
      vi.mocked(ask).mockResolvedValueOnce(false);
      const session = busyChat("/work/app");
      const tabs = [newTab(session.id)];
      const flush = vi.fn();

      await confirmAndCloseWindow(
        [session],
        tabs,
        tabs[0].id,
        "/work/app",
        [],
        flush,
      );

      expect(flush).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith("destroy_window");
    });
  });
});
