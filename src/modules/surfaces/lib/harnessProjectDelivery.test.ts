import { afterEach, expect, it, vi } from "vitest";
import {
  requestHarnessProject,
  subscribeHarnessProjectRequests,
  type DirectedHarnessProjectRequest,
} from "@/modules/surfaces/lib/harnessProjectRequest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const release of cleanups.splice(0)) release();
});
const target = { ownerId: 1, tabKey: asTabKey("tab-one") };

it("delivers a detached immutable target synchronously without a DOM", () => {
  const input = { ...target };
  const first = vi.fn((request: DirectedHarnessProjectRequest) => {
    input.ownerId = 2;
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.target)).toBe(true);
  });
  const second = vi.fn();
  cleanups.push(subscribeHarnessProjectRequests(first));
  cleanups.push(subscribeHarnessProjectRequests(second));
  requestHarnessProject("remote://machine/project", input);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledExactlyOnceWith({
    path: "remote://machine/project",
    target,
  });
  expect(second.mock.calls[0][0]).toBe(first.mock.calls[0][0]);
});

it("retires only the exact subscription even when another owner reuses its callback", () => {
  const receive = vi.fn();
  const original = subscribeHarnessProjectRequests(receive);
  cleanups.push(original, subscribeHarnessProjectRequests(receive));
  original();
  original();
  requestHarnessProject("/current", target);
  expect(receive).toHaveBeenCalledOnce();
});

it("skips a reentrantly retired subscriber and never replays into a new registration", () => {
  const old = vi.fn();
  const replacement = vi.fn();
  let replace = true;
  let retire = () => {};
  cleanups.push(
    subscribeHarnessProjectRequests(() => {
      if (!replace) return;
      replace = false;
      retire();
      cleanups.push(subscribeHarnessProjectRequests(replacement));
    }),
  );
  retire = subscribeHarnessProjectRequests(old);
  cleanups.push(retire);
  requestHarnessProject("/original", target);
  expect(old).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
  requestHarnessProject("/next", target);
  expect(replacement).toHaveBeenCalledExactlyOnceWith({
    path: "/next",
    target,
  });
});

it("bounds live subscriptions and restores capacity after exact release", () => {
  for (let index = 0; index < 256; index++)
    cleanups.push(subscribeHarnessProjectRequests(vi.fn()));
  expect(() => subscribeHarnessProjectRequests(vi.fn())).toThrow("subscribers");
  cleanups[0]();
  const receive = vi.fn();
  cleanups.push(subscribeHarnessProjectRequests(receive));
  requestHarnessProject("//server/share/project", target);
  expect(receive).toHaveBeenCalledExactlyOnceWith({
    path: "//server/share/project",
    target,
  });
});

it("rejects invalid or absent destinations before delivery and retains no replay", () => {
  const receive = vi.fn();
  const release = subscribeHarnessProjectRequests(receive);
  cleanups.push(release);
  for (const invalid of [
    undefined,
    null,
    {},
    { ownerId: 1 },
    { ownerId: -1, tabKey: "tab-one" },
  ])
    Reflect.apply(requestHarnessProject, undefined, ["/project", invalid]);
  requestHarnessProject(" ", target);
  expect(receive).not.toHaveBeenCalled();
  release();
  requestHarnessProject("/unobserved", target);
  const later = vi.fn();
  cleanups.push(subscribeHarnessProjectRequests(later));
  expect(later).not.toHaveBeenCalled();
});
