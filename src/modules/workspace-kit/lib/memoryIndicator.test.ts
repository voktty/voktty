import { expect, it, vi } from "vitest";
import {
  createMemoryIndicator,
  memoryIndicatorState,
} from "@/modules/workspace-kit/lib/memoryIndicator";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import type {
  NativeMemoryScope,
  NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";

const target: MemoryPanelTarget = {
  path: "/project",
  environment: { kind: "local" },
  source: "terminal:1",
};
const selected = {} as NativeMemorySelection;
function scope(state = "ready", root: string | null = "/project") {
  return {
    schema: 1,
    root,
    blockedCount: 0,
    scope: { schema: 1, state, ancestryComplete: true },
  } as NativeMemoryScope;
}
function client() {
  return {
    select: vi.fn(async () => selected),
    inspect: vi.fn(async () => scope()),
    isCurrent: vi.fn(() => true),
    close: vi.fn(async () => {}),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}

it("distinguishes a verified marker from absence, unverified ancestry and malformed facts", () => {
  expect(memoryIndicatorState(scope())).toBe("found");
  expect(memoryIndicatorState(scope("absent", null))).toBe("absent");
  expect(memoryIndicatorState(scope("reserved", null))).toBe("absent");
  expect(memoryIndicatorState({ ...scope(), blockedCount: 1 })).toBe("review");
  expect(
    memoryIndicatorState({
      ...scope(),
      scope: { ...scope().scope, ancestryComplete: false },
    }),
  ).toBe("review");
  for (const state of [
    "denied",
    "invalid",
    "partial",
    "ambiguous",
    "incomplete",
  ])
    expect(memoryIndicatorState(scope(state))).toBe("review");
  expect(memoryIndicatorState(scope("ready", null))).toBe("error");
  expect(memoryIndicatorState(scope("absent"))).toBe("error");
  expect(memoryIndicatorState({ ...scope(), blockedCount: -1 })).toBe("error");
  expect(memoryIndicatorState({} as NativeMemoryScope)).toBe("error");
});

it("only inspects on load, captures the original target and coalesces refreshes", async () => {
  const api = client();
  const notify = vi.fn();
  const input = { ...target };
  const indicator = createMemoryIndicator(input, notify, () => api);
  input.path = "/replacement";
  expect(api.select).not.toHaveBeenCalled();
  const pending = indicator.load();
  expect(indicator.load()).toBe(pending);
  await pending;
  expect(api.select).toHaveBeenCalledExactlyOnceWith("/project", {
    kind: "local",
  });
  expect(api.inspect).toHaveBeenCalledExactlyOnceWith(selected);
  expect(notify.mock.calls.map(([state]) => state)).toEqual([
    "checking",
    "found",
  ]);
  await indicator.load();
  expect(api.select).toHaveBeenCalledOnce();
  await indicator.dispose();
});

it("suppresses late observations and does not select after its original owner retires", async () => {
  const api = client();
  const notify = vi.fn();
  const result = deferred<NativeMemoryScope>();
  const started = deferred<void>();
  api.inspect.mockImplementation(() => {
    started.resolve();
    return result.promise;
  });
  const indicator = createMemoryIndicator(target, notify, () => api);
  const pending = indicator.load();
  await started.promise;
  await indicator.dispose();
  result.resolve(scope());
  await pending;
  expect(notify).toHaveBeenLastCalledWith("checking");
  const opening = deferred<NativeMemorySelection>();
  api.select.mockReturnValueOnce(opening.promise);
  const replacement = createMemoryIndicator(target, notify, () => api);
  const next = replacement.load();
  await Promise.resolve();
  await replacement.dispose();
  opening.resolve(selected);
  await next;
  expect(api.inspect).toHaveBeenCalledOnce();
});

it("does not interpret read failure as absence or admit unsupported transports", async () => {
  const api = client();
  const notify = vi.fn();
  api.inspect.mockRejectedValueOnce({ code: "missingState" });
  const indicator = createMemoryIndicator(target, notify, () => api);
  await indicator.load();
  expect(notify).toHaveBeenLastCalledWith("error");
  await indicator.dispose();
  const create = vi.fn(() => api);
  for (const input of [
    { ...target, path: "remote://host/project" },
    { ...target, environment: { kind: "wsl" as const, distro: "owned" } },
  ])
    expect(() => createMemoryIndicator(input, notify, create)).toThrow();
  expect(create).not.toHaveBeenCalled();
});

it("retains retired reads in its global budget through actual settlement and acknowledged cleanup", async () => {
  const result = deferred<NativeMemoryScope>();
  const api = client();
  api.inspect.mockReturnValue(result.promise);
  const indicators = Array.from({ length: 256 }, () =>
    createMemoryIndicator(
      target,
      () => {},
      () => api,
    ),
  );
  const pending = indicators.map((indicator) => indicator.load());
  await Promise.resolve();
  await Promise.resolve();
  expect(api.inspect).toHaveBeenCalledTimes(256);
  await Promise.all(indicators.map((indicator) => indicator.dispose()));
  expect(() =>
    createMemoryIndicator(
      target,
      () => {},
      () => api,
    ),
  ).toThrow();
  result.resolve(scope());
  await Promise.all(pending);
  const replacement = createMemoryIndicator(
    target,
    () => {},
    () => api,
  );
  await replacement.dispose();
});
