// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { useTrayCommands } from "@/app/hooks/useTrayCommands";

const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

type Entry = {
  name: string;
  callback: () => void;
  stop: Mock<() => void | Promise<void>>;
  resolve: (stop: () => void) => void;
  reject: (error: Error) => void;
};
let entries: Entry[];
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  entries = [];
  native.listen.mockReset().mockImplementation((name: string, callback: () => void) => {
    let resolve!: (stop: () => void) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<() => void>((yes, no) => { resolve = yes; reject = no; });
    entries.push({ name, callback, stop: vi.fn<() => void | Promise<void>>(), resolve, reject });
    return pending;
  });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    for (const entry of entries) entry.resolve(entry.stop);
  });
  vi.unstubAllGlobals();
});

function Window({ terminal, preview }: { terminal: () => void; preview: (url: string) => unknown }) {
  useTrayCommands(terminal, preview);
  return null;
}

it("subscribes independently to the native event names and routes the existing creation actions", async () => {
  const terminal = vi.fn();
  const preview = vi.fn();
  await act(async () => root.render(<Window terminal={terminal} preview={preview} />));
  expect(entries.map((entry) => entry.name)).toEqual(["tray:new_terminal", "tray:new_preview"]);
  await act(async () => {
    for (const entry of entries) { entry.resolve(entry.stop); entry.callback(); }
  });
  expect(terminal).toHaveBeenCalledExactlyOnceWith();
  expect(preview).toHaveBeenCalledExactlyOnceWith("");
});

it("disables retired callbacks before their native registration settles", async () => {
  const terminal = vi.fn();
  const preview = vi.fn();
  await act(async () => root.render(<Window terminal={terminal} preview={preview} />));
  const original = entries[0];
  await act(async () => root.render(null));
  original.callback();
  expect(terminal).not.toHaveBeenCalled();
  await act(async () => original.resolve(original.stop));
  expect(original.stop).toHaveBeenCalledOnce();
  expect(preview).not.toHaveBeenCalled();
});

it("cleans an accepted listener without waiting for its pending sibling", async () => {
  await act(async () => root.render(<Window terminal={vi.fn()} preview={vi.fn()} />));
  const original = entries[0];
  await act(async () => original.resolve(original.stop));
  await act(async () => root.render(null));
  expect(original.stop).toHaveBeenCalledOnce();
});

it("uses committed replacement actions without registering another listener", async () => {
  const original = vi.fn();
  const replacement = vi.fn();
  const preview = vi.fn();
  await act(async () => root.render(<Window terminal={original} preview={preview} />));
  await act(async () => { for (const entry of entries) entry.resolve(entry.stop); });
  await act(async () => root.render(<Window terminal={replacement} preview={preview} />));
  expect(native.listen).toHaveBeenCalledTimes(2);
  entries[0].callback();
  entries[1].callback();
  expect(original).not.toHaveBeenCalled();
  expect(replacement).toHaveBeenCalledOnce();
  expect(preview).toHaveBeenCalledExactlyOnceWith("");
});

it("keeps only current listeners active during StrictMode replay", async () => {
  const terminal = vi.fn();
  const preview = vi.fn();
  await act(async () => root.render(<StrictMode><Window terminal={terminal} preview={preview} /></StrictMode>));
  expect(entries.map((entry) => entry.name)).toEqual(["tray:new_terminal", "tray:new_preview", "tray:new_terminal", "tray:new_preview"]);
  await act(async () => { for (const entry of entries) entry.resolve(entry.stop); });
  for (const entry of entries) entry.callback();
  expect(terminal).toHaveBeenCalledOnce();
  expect(preview).toHaveBeenCalledExactlyOnceWith("");
  expect(entries[0].stop).toHaveBeenCalledOnce();
  expect(entries[1].stop).toHaveBeenCalledOnce();
  expect(entries[2].stop).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  for (const entry of entries) {
    expect(entry.stop).toHaveBeenCalledOnce();
    entry.callback();
  }
  expect(terminal).toHaveBeenCalledOnce();
  expect(preview).toHaveBeenCalledOnce();
});

it.each(["sync", "async"] as const)("observes %s registration rejection and keeps the sibling usable", async (mode) => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("Native listen failed");
  const terminal = vi.fn();
  const preview = vi.fn();
  try {
    if (mode === "sync") native.listen.mockImplementationOnce(() => { throw error; });
    await act(async () => root.render(<Window terminal={terminal} preview={preview} />));
    if (mode === "async") {
      await act(async () => entries[0].reject(error));
      entries[0].callback();
    }
    const sibling = entries.find((entry) => entry.name === "tray:new_preview");
    if (!sibling) throw new Error("Missing sibling listener");
    await act(async () => sibling.resolve(sibling.stop));
    sibling.callback();
    expect(terminal).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledExactlyOnceWith("");
    expect(report).toHaveBeenCalledExactlyOnceWith("[voktty] tray listener setup failed:", "tray:new_terminal", error);
  } finally { report.mockRestore(); }
});

it.each(["sync", "async"] as const)("observes %s cleanup rejection without skipping the sibling or enabling stale actions", async (mode) => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const terminal = vi.fn();
  const preview = vi.fn();
  const error = new Error("Native unlisten failed");
  try {
    await act(async () => root.render(<Window terminal={terminal} preview={preview} />));
    if (mode === "sync") entries[0].stop.mockImplementationOnce(() => { throw error; });
    else entries[0].stop.mockRejectedValueOnce(error);
    await act(async () => { for (const entry of entries) entry.resolve(entry.stop); });
    await act(async () => root.render(null));
    for (const entry of entries) { expect(entry.stop).toHaveBeenCalledOnce(); entry.callback(); }
    expect(terminal).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledExactlyOnceWith("[voktty] tray listener cleanup failed:", "tray:new_terminal", error);
  } finally { report.mockRestore(); }
});
