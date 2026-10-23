import { describe, expect, it } from "vitest";
import { nextUnseenFinishedSessions } from "./sessionDone";

describe("nextUnseenFinishedSessions", () => {
  it("clears every foreground session while preserving a headless completion", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(["one", "two", "headless"]),
        busyIds: new Set(),
        previousUnseenIds: new Set(["already-visible", "unseen"]),
        focusedSessionIds: new Set(["one", "two", "already-visible"]),
      }),
    ).toEqual(new Set(["unseen", "headless"]));
  });

  it("combines the legacy focus and foreground set without marking workers", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(["one", "two", "worker"]),
        busyIds: new Set(),
        previousUnseenIds: new Set(),
        focusedSessionId: "one",
        focusedSessionIds: new Set(["two"]),
        untrackedIds: new Set(["worker"]),
      }),
    ).toEqual(new Set());
  });

  it("marks a session done when it finishes while unfocused", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(["a"]),
        busyIds: new Set(),
        previousUnseenIds: new Set(),
        focusedSessionId: "b",
      }),
    ).toEqual(new Set(["a"]));
  });

  it("does not mark a session done when it finishes while focused", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(["a"]),
        busyIds: new Set(),
        previousUnseenIds: new Set(),
        focusedSessionId: "a",
      }),
    ).toEqual(new Set());
  });

  it("clears done when the session is focused", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(),
        busyIds: new Set(),
        previousUnseenIds: new Set(["a"]),
        focusedSessionId: "a",
      }),
    ).toEqual(new Set());
  });

  it("clears done when the session starts working again", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(),
        busyIds: new Set(["a"]),
        previousUnseenIds: new Set(["a"]),
        focusedSessionId: "b",
      }),
    ).toEqual(new Set());
  });

  it("keeps done on other sessions while one is focused", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(),
        busyIds: new Set(),
        previousUnseenIds: new Set(["a", "b"]),
        focusedSessionId: "a",
      }),
    ).toEqual(new Set(["b"]));
  });

  it("never marks sessions the user cannot look at", () => {
    // An unseen session stays loaded until focused; a worker never is.
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(["lead", "worker"]),
        busyIds: new Set(),
        previousUnseenIds: new Set(),
        focusedSessionId: "other",
        untrackedIds: new Set(["worker"]),
      }),
    ).toEqual(new Set(["lead"]));
  });

  it("drops untracked sessions that were already marked", () => {
    expect(
      nextUnseenFinishedSessions({
        previousBusyIds: new Set(),
        busyIds: new Set(),
        previousUnseenIds: new Set(["lead", "worker"]),
        focusedSessionId: "other",
        untrackedIds: new Set(["worker"]),
      }),
    ).toEqual(new Set(["lead"]));
  });
});
