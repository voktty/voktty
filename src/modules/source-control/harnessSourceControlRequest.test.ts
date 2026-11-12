import { afterEach, expect, it, vi } from "vitest";
import {
  requestHarnessSourceControl,
  subscribeHarnessSourceControl,
} from "@/modules/source-control/harnessSourceControlRequest";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

it.each([
  "/projects/repo",
  "/projects/repo/.git/voktty-worktrees/feature",
  "C:/Projects/repo",
  "remote://voktty-ssh-build/work/repo",
])("delivers the exact requested repository: %s", (path) => {
  const receive = vi.fn();
  cleanups.push(subscribeHarnessSourceControl(receive));
  expect(requestHarnessSourceControl(path)).toBe(true);
  expect(receive).toHaveBeenCalledExactlyOnceWith(path, expect.any(Function));
});

it.each(["", "  ", "~", "/repo\nother", "a".repeat(32769)])(
  "rejects an invalid target",
  (path) => {
    const receive = vi.fn();
    cleanups.push(subscribeHarnessSourceControl(receive));
    expect(requestHarnessSourceControl(path)).toBe(false);
    expect(receive).not.toHaveBeenCalled();
  },
);

it("does not replay to replacements or deliver to a retired subscriber", () => {
  const replacement = vi.fn();
  const retired = vi.fn();
  let retire = () => {};
  cleanups.push(subscribeHarnessSourceControl(() => {
    retire();
    cleanups.push(subscribeHarnessSourceControl(replacement));
  }));
  retire = subscribeHarnessSourceControl(retired);
  cleanups.push(retire);
  expect(requestHarnessSourceControl("/repo")).toBe(true);
  expect(retired).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
});

it("returns unavailable after the receiver closes", () => {
  const receive = vi.fn();
  const close = subscribeHarnessSourceControl(receive);
  close();
  close();
  expect(requestHarnessSourceControl("/repo")).toBe(false);
  expect(receive).not.toHaveBeenCalled();
});

it("rejects a retired sender before delivery", () => {
  const receive = vi.fn();
  cleanups.push(subscribeHarnessSourceControl(receive));
  expect(requestHarnessSourceControl("/repo", () => false)).toBe(false);
  expect(receive).not.toHaveBeenCalled();
});

it("retires captured guards and later receivers after a reentrant sender change", () => {
  let live = true;
  let captured: (() => boolean) | undefined;
  const later = vi.fn();
  cleanups.push(subscribeHarnessSourceControl((_path, current) => {
    captured = current;
    expect(current()).toBe(true);
    live = false;
  }));
  cleanups.push(subscribeHarnessSourceControl(later));
  expect(requestHarnessSourceControl("/repo", () => live)).toBe(true);
  expect(captured?.()).toBe(false);
  expect(later).not.toHaveBeenCalled();
});

it("retires a receiver's captured guard when its subscription closes", () => {
  let captured: (() => boolean) | undefined;
  const close = subscribeHarnessSourceControl((_path, current) => { captured = current; });
  cleanups.push(close);
  expect(requestHarnessSourceControl("/repo")).toBe(true);
  expect(captured?.()).toBe(true);
  close();
  expect(captured?.()).toBe(false);
});
