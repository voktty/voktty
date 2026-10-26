import { expect, it, vi } from "vitest";
import { createChatActionOwner } from "@/modules/ai/lib/chatActionOwner";

function fixture() {
  let current = true;
  let chat: object | undefined;
  const owner = createChatActionOwner({
    isCurrent: () => current,
    getChat: () => chat,
  });
  return {
    owner,
    select: (value: boolean) => {
      current = value;
    },
    register: (value: object | undefined) => {
      chat = value;
    },
  };
}
function deferred() {
  let finish!: (value: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

it("never revives an observed retired selection or replaced Chat", () => {
  const first = fixture();
  const original = {};
  first.register(original);
  expect(first.owner.resolve()).toBe(original);
  first.select(false);
  expect(first.owner.isCurrent()).toBe(false);
  first.select(true);
  expect(first.owner.isCurrent()).toBe(false);
  const replacement = fixture();
  replacement.register(original);
  expect(replacement.owner.resolve()).toBe(original);
  replacement.register({});
  expect(replacement.owner.resolve()).toBeUndefined();
  replacement.register(original);
  expect(replacement.owner.isCurrent()).toBe(false);
});

it("binds a first Chat without borrowing an unregistered or reentrantly replaced result", () => {
  const first = fixture();
  const chat = {};
  expect(
    first.owner.resolve(() => {
      first.register(chat);
      return chat;
    }),
  ).toBe(chat);
  const second = fixture();
  expect(second.owner.resolve(() => chat)).toBeUndefined();
  const third = fixture();
  expect(
    third.owner.resolve(() => {
      third.select(false);
      third.register(chat);
      return chat;
    }),
  ).toBeUndefined();
});

it("retains admission through the original task settlement and coalesces duplicates", async () => {
  const source = fixture();
  const pending = deferred();
  const task = vi.fn(() => pending.promise);
  const first = source.owner.run(task);
  expect(await source.owner.run(task)).toBe(false);
  expect(task).toHaveBeenCalledTimes(1);
  pending.finish(true);
  expect(await first).toBe(true);
  expect(await source.owner.run(async () => true)).toBe(true);
});

it("counts all 256 retired tasks until physical settlement and then admits fresh work", async () => {
  const owners = Array.from({ length: 256 }, fixture);
  const pending = owners.map(() => deferred());
  const running = owners.map(({ owner }, index) =>
    owner.run(() => pending[index].promise),
  );
  for (const { owner } of owners) owner.retire();
  const successor = fixture();
  const task = vi.fn(async () => true);
  try {
    expect(await successor.owner.run(task)).toBe(false);
    expect(task).not.toHaveBeenCalled();
    pending[0].finish(true);
    expect(await running[0]).toBe(true);
    expect(await successor.owner.run(task)).toBe(true);
  } finally {
    for (const entry of pending) entry.finish(false);
    await Promise.all(running);
  }
});

it("releases failed task admission and never enters a retired task", async () => {
  const source = fixture();
  expect(
    await source.owner.run(async () => {
      throw new Error("fixture");
    }),
  ).toBe(false);
  expect(await source.owner.run(async () => true)).toBe(true);
  source.owner.retire();
  const task = vi.fn(async () => true);
  expect(await source.owner.run(task)).toBe(false);
  expect(task).not.toHaveBeenCalled();
});

it("cancels pending authority without releasing its task or retiring future actions", async () => {
  const source = fixture();
  const pending = deferred();
  let originalGuard: (() => boolean) | undefined;
  const running = source.owner.run(async (current) => {
    originalGuard = current;
    return await pending.promise;
  });
  expect(originalGuard?.()).toBe(true);
  source.owner.cancelPending();
  expect(originalGuard?.()).toBe(false);
  expect(source.owner.isCurrent()).toBe(true);
  expect(await source.owner.run(async () => true)).toBe(false);
  pending.finish(false);
  expect(await running).toBe(false);
  expect(await source.owner.run(async (current) => current())).toBe(true);
  expect(originalGuard?.()).toBe(false);
});
