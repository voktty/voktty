// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useExplorerReveal,
  type ExplorerReveal,
} from "@/modules/explorer/lib/useExplorerReveal";

let root: Root;
let node: HTMLDivElement;
let reveal: ExplorerReveal;
const read = vi.fn<ExplorerReveal>();
const select = vi.fn<(path: string, guard: () => boolean) => void>();
const scroll = vi.fn();
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
function Probe({ scope }: { scope: object }) {
  reveal = useExplorerReveal({ scope, revealTree: read, select, scroll });
  return null;
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function render(scope: object) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe scope={scope} />
      </StrictMode>,
    ),
  );
}
function flushFrames() {
  const current = [...frames.values()];
  frames.clear();
  for (const frame of current) frame(0);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    frames.set(++frameId, frame);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  read.mockReset().mockResolvedValue(true);
  select.mockReset();
  scroll.mockReset();
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
});

it("reveals through the captured reader and keeps the deferred selection guard current through scrolling", async () => {
  await render({});
  expect(await reveal("/work/a.ts")).toBe(true);
  expect(read).toHaveBeenCalledWith("/work/a.ts", expect.any(Function));
  expect(select).toHaveBeenCalledWith("/work/a.ts", expect.any(Function));
  const guard = select.mock.calls[0][1];
  expect(guard()).toBe(true);
  expect(scroll).not.toHaveBeenCalled();
  flushFrames();
  expect(scroll).toHaveBeenCalledExactlyOnceWith("/work/a.ts");
  expect(guard()).toBe(true);
});

it.each(["scope", "unmount", "caller"])(
  "rejects late selection and scroll after %s retirement",
  async (kind) => {
    const scope = {};
    await render(scope);
    const deferred = pending<boolean>();
    read.mockReturnValueOnce(deferred.promise);
    let current = true;
    const result = reveal("/work/old.ts", () => current);
    const guard = read.mock.calls[0][1];
    if (!guard) throw new Error("Missing captured reader guard.");
    if (kind === "scope") {
      await render({});
      await render(scope);
    }
    if (kind === "unmount") await act(async () => root.render(null));
    if (kind === "caller") current = false;
    expect(guard()).toBe(false);
    deferred.resolve(true);
    expect(await result).toBe(false);
    flushFrames();
    expect(select).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  },
);

it("retires the previous read and cancels its scheduled frame before a newer request", async () => {
  await render({});
  const deferred = pending<boolean>();
  read.mockReturnValueOnce(deferred.promise);
  const old = reveal("/work/old.ts");
  expect(await reveal("/work/new.ts")).toBe(true);
  deferred.resolve(true);
  expect(await old).toBe(false);
  expect(select).toHaveBeenCalledTimes(1);
  const oldGuard = select.mock.calls[0][1];
  expect(await reveal("/work/final.ts")).toBe(true);
  expect(oldGuard()).toBe(false);
  expect(frames.size).toBe(1);
  flushFrames();
  expect(scroll).toHaveBeenCalledExactlyOnceWith("/work/final.ts");
});

it("refuses cached old readers and observes caller retirement after a successful read", async () => {
  await render({});
  const cached = reveal;
  await render({});
  expect(await cached("/work/a.ts")).toBe(false);
  expect(read).not.toHaveBeenCalled();
  let current = true;
  select.mockImplementationOnce(() => {
    current = false;
  });
  expect(await reveal("/work/a.ts", () => current)).toBe(false);
  expect(frames.size).toBe(0);
});

it("propagates an actual reader rejection without publishing or scrolling", async () => {
  await render({});
  const error = new Error("read failed");
  read.mockRejectedValueOnce(error);
  await expect(reveal("/work/a.ts")).rejects.toBe(error);
  expect(select).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

it("rejects an already retired caller without entering the reader", async () => {
  await render({});
  expect(await reveal("/work/a.ts", () => false)).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

it("cancels its queued scroll on unmount and invalidates deferred selection updaters", async () => {
  await render({});
  expect(await reveal("/work/a.ts")).toBe(true);
  const guard = select.mock.calls[0][1];
  await act(async () => root.render(null));
  expect(guard()).toBe(false);
  flushFrames();
  expect(scroll).not.toHaveBeenCalled();
});
