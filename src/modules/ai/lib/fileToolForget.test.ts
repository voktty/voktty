import { expect, it, vi } from "vitest";
import {
  createFileToolCalls,
  fileToolCallsFor,
  inheritFileToolCalls,
} from "@/modules/ai/lib/fileToolCalls";

const target = {
  directory: "/fixture",
  root: "/fixture",
  workspace: { kind: "local" as const },
};

it("keeps Stop reusable but permanently seals a forgotten root", () => {
  const calls = createFileToolCalls();
  calls.capture("old", "read_file", {}, target);
  calls.retireAll();
  calls.capture("new", "bash_background", {}, target);
  expect(calls.isCurrent()).toBe(true);
  calls.forget();
  expect(calls.isCurrent()).toBe(false);
  calls.retireAll();
  expect(() => calls.capture("late", "bash_background", {}, target)).toThrow(
    "retired",
  );
  expect(() => calls.claim("new", "bash_background", {})).toThrow(
    "unavailable",
  );
});

it("retires the forgotten family's children without retiring an unrelated owner", () => {
  const parent = {};
  const child = {};
  const other = createFileToolCalls();
  inheritFileToolCalls(parent, child);
  const calls = fileToolCallsFor(child);
  calls.capture("child", "read_file", {}, target);
  const running = calls.claim("child", "read_file", {});
  other.capture("other", "read_file", {}, target);
  fileToolCallsFor(parent).forget();
  expect(running.isCurrent()).toBe(false);
  expect(calls.isCurrent()).toBe(false);
  expect(() => inheritFileToolCalls(parent, {})).toThrow("retired");
  expect(other.preview("other", "read_file", {})).toEqual(target);
  running.release();
  other.retireAll();
});

it("finishes its captured retirement cohort despite a collection callback failing", () => {
  const calls = createFileToolCalls();
  const collected = vi.fn();
  calls.capture("first", "read_file", {}, target, () => {
    throw new Error("presentation failed");
  });
  calls.capture("second", "read_file", {}, target, collected);
  expect(() => calls.forget()).not.toThrow();
  expect(collected).toHaveBeenCalledTimes(1);
  expect(calls.isCurrent()).toBe(false);
});

it("seals before collection callbacks can attempt to revive the old owner", () => {
  const calls = createFileToolCalls();
  const callback = vi.fn(() => {
    expect(() =>
      calls.capture("replacement", "write_file", {}, target),
    ).toThrow("retired");
  });
  calls.capture("first", "read_file", {}, target, callback);
  calls.forget();
  expect(callback).toHaveBeenCalledTimes(1);
});

it("forgets one child without retiring the parent or a sibling namespace", () => {
  const parent = {};
  const child = {};
  const sibling = {};
  inheritFileToolCalls(parent, child);
  inheritFileToolCalls(parent, sibling);
  fileToolCallsFor(child).capture("child", "read_file", {}, target);
  fileToolCallsFor(sibling).capture("sibling", "read_file", {}, target);
  fileToolCallsFor(child).forget();
  expect(fileToolCallsFor(child).isCurrent()).toBe(false);
  expect(fileToolCallsFor(parent).isCurrent()).toBe(true);
  expect(fileToolCallsFor(sibling).preview("sibling", "read_file", {})).toEqual(
    target,
  );
  fileToolCallsFor(parent).retireAll();
});
