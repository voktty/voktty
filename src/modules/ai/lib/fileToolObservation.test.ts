import { expect, it, vi } from "vitest";
import { createFileToolCalls } from "@/modules/ai/lib/fileToolCalls";

const target = {
  directory: "/fixture",
  root: "/fixture",
  workspace: { kind: "local" as const },
};
const input = { command: "fixture" };

it("notifies retirement once and retains running capacity until settlement", () => {
  const calls = createFileToolCalls();
  calls.capture("call", "bash_run", input, target).bindApproval("approval");
  const running = calls.claim("call", "bash_run", input, "approval");
  const notify = vi.fn(() => expect(running.isCurrent()).toBe(false));
  const observation = calls.observe(
    "call",
    "bash_run",
    input,
    "approval",
    notify,
  );
  calls.retireApprovalId("approval");
  calls.retireApprovalId("approval");
  expect(notify).toHaveBeenCalledTimes(1);
  observation.release();
  for (let index = 0; index < 255; index++)
    calls.capture(String(index), "read_file", {}, target);
  expect(() => calls.capture("extra", "read_file", {}, target)).toThrow(
    "Too many",
  );
  running.release();
  calls.capture("extra", "read_file", {}, target);
  calls.retireAll();
});

it("removes a released observation without retiring its original capture", () => {
  const calls = createFileToolCalls();
  calls.capture("call", "bash_run", input, target);
  const notify = vi.fn();
  const observation = calls.observe(
    "call",
    "bash_run",
    input,
    undefined,
    notify,
  );
  observation.release();
  expect(observation.isCurrent()).toBe(true);
  calls.retire("call");
  expect(notify).not.toHaveBeenCalled();
});

it("preserves retirement and sibling delivery if an observer throws", () => {
  const calls = createFileToolCalls();
  calls.capture("call", "bash_run", input, target);
  const first = calls.observe("call", "bash_run", input, undefined, () => {
    throw new Error("presentation failed");
  });
  const notify = vi.fn();
  const second = calls.observe("call", "bash_run", input, undefined, notify);
  expect(() => calls.retire("call")).not.toThrow();
  expect(first.isCurrent()).toBe(false);
  expect(second.isCurrent()).toBe(false);
  expect(notify).toHaveBeenCalledTimes(1);
  first.release();
  second.release();
});

it("retires only the cohort captured before reentrant collection", () => {
  const calls = createFileToolCalls();
  calls
    .capture("call", "bash_run", input, target, () => {
      calls.capture("call", "bash_run", input, target).bindApproval("approval");
    })
    .bindApproval("approval");
  calls.retireApprovalId("approval");
  const successor = calls.claim("call", "bash_run", input, "approval");
  expect(successor.isCurrent()).toBe(true);
  successor.release();
});
