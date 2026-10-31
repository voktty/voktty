import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeAiFileRoot } from "@/modules/ai/lib/aiRootObservation";
import { useChatStore } from "@/modules/ai/store/chatStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
let releases: (() => void)[];
beforeEach(() => {
  releases = [];
  const state = useChatStore.getState();
  state.setLive({ ...state.live, subscribeFileRootContext: undefined });
});
afterEach(() => {
  for (const release of releases) release();
});

it("does not notify root observers for streaming metadata or selection changes", () => {
  const listener = vi.fn();
  releases.push(subscribeAiFileRoot(listener));
  useChatStore.setState({ unreadCount: 1 });
  useChatStore.setState({ activeSessionId: "sibling" });
  expect(listener).not.toHaveBeenCalled();
});

it("bounds subscribers and restores capacity on exact idempotent release", () => {
  for (let index = 0; index < 256; index++)
    releases.push(subscribeAiFileRoot(() => undefined));
  expect(() => subscribeAiFileRoot(() => undefined)).toThrow("busy");
  releases[0]();
  releases[0]();
  releases.push(subscribeAiFileRoot(() => undefined));
  expect(() => subscribeAiFileRoot(() => undefined)).toThrow("busy");
});

it("releases partial subscriptions after repeated initial failures", () => {
  const state = useChatStore.getState();
  state.setLive({
    ...state.live,
    subscribeFileRootContext: () => {
      throw new Error("fixture observation failed");
    },
  });
  for (let index = 0; index < 257; index++)
    expect(() => subscribeAiFileRoot(() => undefined)).toThrow(
      "fixture observation failed",
    );
  state.setLive({ ...state.live, subscribeFileRootContext: undefined });
  releases.push(subscribeAiFileRoot(() => undefined));
});

it("releases a late registration from a superseded publication", () => {
  const state = useChatStore.getState();
  const oldRelease = vi.fn();
  const newRelease = vi.fn();
  const replacement = {
    ...state.live,
    subscribeFileRootContext: () => newRelease,
  };
  state.setLive({
    ...state.live,
    subscribeFileRootContext: () => {
      state.setLive(replacement);
      return oldRelease;
    },
  });
  const release = subscribeAiFileRoot(() => undefined);
  releases.push(release);
  expect(oldRelease).toHaveBeenCalledTimes(1);
  expect(newRelease).not.toHaveBeenCalled();
  release();
  expect(newRelease).toHaveBeenCalledTimes(1);
});
