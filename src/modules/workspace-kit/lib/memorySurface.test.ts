import { expect, it, vi } from "vitest";
import { createMemorySurfaceRegistry } from "@/modules/workspace-kit/lib/memorySurface";

function source() {
  return {
    source: "harness:1:key",
    target: {
      path: "/project",
      environment: { kind: "local" as const },
      source: "harness:1:key",
    },
    captureConversation: vi.fn(() => null),
    isCurrent: vi.fn(() => true),
  };
}

it("publishes display metadata without capturing a conversation and retains the original callbacks", () => {
  const registry = createMemorySurfaceRegistry();
  const input = source();
  const originalCapture = input.captureConversation;
  const release = registry.publish(input);
  const receipt = registry.getSnapshot();
  input.target.path = "/replacement";
  input.captureConversation = vi.fn(() => null);
  expect(receipt?.target?.path).toBe("/project");
  expect(originalCapture).not.toHaveBeenCalled();
  receipt?.captureConversation();
  expect(originalCapture).toHaveBeenCalledOnce();
  expect(input.captureConversation).not.toHaveBeenCalled();
  release();
  expect(registry.getSnapshot()).toBeNull();
  receipt?.captureConversation();
  expect(originalCapture).toHaveBeenCalledOnce();
});

it("never lets an old cleanup erase a replacement or revive its capture after a round trip", () => {
  const registry = createMemorySurfaceRegistry();
  const input = source();
  const release = registry.publish(input);
  const previous = registry.getSnapshot();
  const stopReplacement = registry.publish(source());
  const replacement = registry.getSnapshot();
  release();
  expect(registry.getSnapshot()).toBe(replacement);
  expect(previous?.isCurrent()).toBe(false);
  registry.publish(input)();
  stopReplacement();
  expect(previous?.isCurrent()).toBe(false);
  expect(replacement?.isCurrent()).toBe(false);
});

it("permanently retires an observed invalid source", () => {
  const registry = createMemorySurfaceRegistry();
  const input = source();
  const release = registry.publish(input);
  const receipt = registry.getSnapshot();
  input.isCurrent.mockReturnValue(false);
  expect(receipt?.isCurrent()).toBe(false);
  input.isCurrent.mockReturnValue(true);
  expect(receipt?.isCurrent()).toBe(false);
  receipt?.captureConversation();
  expect(input.captureConversation).not.toHaveBeenCalled();
  release();
});

it("bounds observers and isolates a failed observer from publication and cleanup", () => {
  const registry = createMemorySurfaceRegistry();
  const releaseObservers = Array.from({ length: 256 }, () =>
    registry.subscribe(() => {
      throw new Error("observer");
    }),
  );
  expect(() => registry.subscribe(() => {})).toThrow();
  const release = registry.publish(source());
  expect(registry.getSnapshot()).not.toBeNull();
  release();
  expect(registry.getSnapshot()).toBeNull();
  for (const stop of releaseObservers) stop();
  registry.subscribe(() => {})();
});
