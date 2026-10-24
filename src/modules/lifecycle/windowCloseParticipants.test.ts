import { expect, it, vi } from "vitest";
import {
  createWindowCloseParticipants,
  type WindowCloseCapture,
} from "@/modules/lifecycle/windowCloseParticipants";

function source(patch: Partial<WindowCloseCapture> = {}): WindowCloseCapture {
  return {
    busy: false,
    closeToTray: false,
    isCurrent: () => true,
    cancel: vi.fn(),
    prepare: vi.fn(async () => ({ isCurrent: () => true, cancel: vi.fn() })),
    hide: vi.fn(async () => {}),
    ...patch,
  };
}

it("collects busy participants, coalesces preparation and cancels the original captures", async () => {
  const registry = createWindowCloseParticipants();
  const first = source({ busy: true });
  const second = source();
  registry.register(() => first);
  registry.register(() => second);
  const capture = registry.capture();
  expect(capture.busy).toBe(true);
  expect(capture.prepare()).toBe(capture.prepare());
  await capture.prepare();
  expect(first.prepare).toHaveBeenCalledOnce();
  expect(second.prepare).toHaveBeenCalledOnce();
  capture.cancel();
  capture.cancel();
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(second.cancel).toHaveBeenCalledOnce();
  expect(capture.isCurrent()).toBe(false);
});

it("vetoes membership changes without preparing a replacement", async () => {
  const registry = createWindowCloseParticipants();
  const original = source();
  const replacement = source();
  const release = registry.register(() => original);
  const captured = registry.capture();
  release();
  registry.register(() => replacement);
  await expect(captured.prepare()).rejects.toThrow("retired");
  expect(original.prepare).not.toHaveBeenCalled();
  expect(replacement.prepare).not.toHaveBeenCalled();
});

it("retires a late preparation receipt after cancellation", async () => {
  const registry = createWindowCloseParticipants();
  const receipt = { isCurrent: () => true, cancel: vi.fn() };
  let resolve!: (value: typeof receipt) => void;
  const pending = new Promise<typeof receipt>((yes) => {
    resolve = yes;
  });
  const original = source({ prepare: () => pending });
  registry.register(() => original);
  const captured = registry.capture();
  const preparing = captured.prepare();
  const observed = expect(preparing).rejects.toThrow("retired");
  captured.cancel();
  expect(original.cancel).toHaveBeenCalledOnce();
  resolve(receipt);
  await observed;
  expect(receipt.cancel).toHaveBeenCalledOnce();
});

it("cancels earlier preparations if a later participant rejects", async () => {
  const registry = createWindowCloseParticipants();
  const first = source();
  const failure = new Error("write failed");
  registry.register(() => first);
  registry.register(() =>
    source({
      prepare: async () => {
        throw failure;
      },
    }),
  );
  const captured = registry.capture();
  await expect(captured.prepare()).rejects.toBe(failure);
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(captured.isCurrent()).toBe(false);
});

it("bounds live contributors and makes release exact and idempotent", () => {
  const registry = createWindowCloseParticipants();
  const sources = Array.from({ length: 16 }, () => () => source());
  const releases = sources.map((entry) => registry.register(entry));
  expect(() => registry.register(() => source())).toThrow("capacity");
  releases[0]();
  releases[0]();
  registry.register(() => source());
  expect(() => registry.register(() => source())).toThrow("capacity");
});

it("hides through only a current tray participant", async () => {
  const registry = createWindowCloseParticipants();
  const tray = source({ closeToTray: true });
  const release = registry.register(() => tray);
  const captured = registry.capture();
  await captured.hide();
  expect(tray.hide).toHaveBeenCalledOnce();
  release();
  await expect(captured.hide()).rejects.toThrow("retired");
});
