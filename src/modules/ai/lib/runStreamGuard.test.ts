import { expect, it, vi } from "vitest";
import { guardRunStream } from "@/modules/ai/lib/runStreamGuard";

it("preserves current output and cleans up once on normal completion", async () => {
  const cleanup = vi.fn();
  const retire = vi.fn();
  const source = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("first");
      controller.enqueue("second");
      controller.close();
    },
  });
  const reader = guardRunStream(
    source,
    () => true,
    retire,
    cleanup,
  ).getReader();
  expect(await reader.read()).toEqual({ value: "first", done: false });
  expect(await reader.read()).toEqual({ value: "second", done: false });
  expect(await reader.read()).toMatchObject({ done: true });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(retire).not.toHaveBeenCalled();
});
it("does not publish a pending chunk after retirement", async () => {
  let current = true;
  let publish!: (text: string) => void;
  const cancel = vi.fn();
  const source = new ReadableStream<string>({
    start(controller) {
      publish = (text) => controller.enqueue(text);
    },
    cancel,
  });
  const cleanup = vi.fn();
  const retire = vi.fn();
  const reader = guardRunStream(
    source,
    () => current,
    retire,
    cleanup,
  ).getReader();
  const pending = reader.read();
  current = false;
  publish("retired content");
  expect(await pending).toMatchObject({ done: true });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(retire).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("does not expose errors from retired work", async () => {
  let current = true;
  let fail!: (error: Error) => void;
  const source = new ReadableStream<string>({
    start(controller) {
      fail = (error) => controller.error(error);
    },
  });
  const cleanup = vi.fn();
  const retire = vi.fn();
  const reader = guardRunStream(
    source,
    () => current,
    retire,
    cleanup,
  ).getReader();
  const pending = reader.read();
  current = false;
  fail(new Error("retired private error"));
  expect(await pending).toMatchObject({ done: true });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(retire).toHaveBeenCalledTimes(1);
});
it("retains errors from the current run", async () => {
  const error = new Error("provider failed");
  const cleanup = vi.fn();
  const source = new ReadableStream<string>({
    start(controller) {
      controller.error(error);
    },
  });
  const reader = guardRunStream(
    source,
    () => true,
    vi.fn(),
    cleanup,
  ).getReader();
  await expect(reader.read()).rejects.toBe(error);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
it("cancels the original source and releases listeners on consumer cancellation", async () => {
  const cancel = vi.fn();
  const cleanup = vi.fn();
  const retire = vi.fn();
  const source = new ReadableStream<string>({ cancel });
  const reader = guardRunStream(
    source,
    () => true,
    retire,
    cleanup,
  ).getReader();
  await reader.cancel("stop");
  expect(cancel).toHaveBeenCalledWith("stop");
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(retire).toHaveBeenCalledTimes(1);
});
it("does not reopen a retired presentation when native cancellation rejects", async () => {
  const cleanup = vi.fn();
  const retire = vi.fn();
  const source = new ReadableStream<string>({
    cancel: async () => {
      throw new Error("late cancel failure");
    },
  });
  const reader = guardRunStream(
    source,
    () => false,
    retire,
    cleanup,
  ).getReader();
  expect(await reader.read()).toMatchObject({ done: true });
  await Promise.resolve();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(retire).toHaveBeenCalledTimes(1);
});
it("settles one cancellation while an original read is still pending", async () => {
  const cancel = vi.fn();
  const cleanup = vi.fn();
  const retire = vi.fn();
  const reading = vi.fn();
  const source = new ReadableStream<string>({ pull: reading, cancel });
  const reader = guardRunStream(
    source,
    () => true,
    retire,
    cleanup,
  ).getReader();
  const pending = reader.read();
  await vi.waitFor(() => expect(reading).toHaveBeenCalled());
  await reader.cancel("stop");
  expect(await pending).toMatchObject({ done: true });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(retire).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("keeps the snapshot reserved until original cancellation settles", async () => {
  let resolveCancel!: () => void;
  const cancelling = new Promise<void>((resolve) => {
    resolveCancel = resolve;
  });
  const cleanup = vi.fn();
  const settle = vi.fn();
  const source = new ReadableStream<string>({ cancel: () => cancelling });
  const reader = guardRunStream(
    source,
    () => true,
    vi.fn(),
    cleanup,
    settle,
  ).getReader();
  const pending = reader.read();
  const cancelled = reader.cancel();
  expect(await pending).toMatchObject({ done: true });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(settle).not.toHaveBeenCalled();
  resolveCancel();
  await cancelled;
  expect(settle).toHaveBeenCalledTimes(1);
});

it("settles the original source exactly once after normal completion", async () => {
  const settle = vi.fn();
  const source = new ReadableStream<string>({
    start(controller) {
      controller.close();
    },
  });
  const reader = guardRunStream(
    source,
    () => true,
    vi.fn(),
    vi.fn(),
    settle,
  ).getReader();
  expect(await reader.read()).toMatchObject({ done: true });
  await reader.cancel();
  expect(settle).toHaveBeenCalledTimes(1);
});
