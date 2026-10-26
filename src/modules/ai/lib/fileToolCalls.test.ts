import { expect, it } from "vitest";
import {
  createFileToolCalls,
  fileToolCallsFor,
  inheritFileToolCalls,
  type FileToolTarget,
} from "@/modules/ai/lib/fileToolCalls";

const target = (): FileToolTarget => ({
  directory: "/fixture/project/src",
  root: "/fixture/project",
  workspace: {
    kind: "ssh",
    root: "/fixture/project",
    sessionId: 7,
    connection: { id: "fixture", name: "Fixture", host: "fixture.invalid" },
  },
});
const input = () => ({ path: "file.ts", content: "fixture" });

it("keeps approval binding exact across same-ID replacements", () => {
  const calls = createFileToolCalls();
  const old = calls.capture("call", "write_file", input(), target());
  old.bindApproval("old");
  old.retire();
  const current = calls.capture("call", "write_file", input(), target());
  current.bindApproval("current");
  old.bindApproval("old");
  calls.retireApproval("call", "old");
  expect(() => calls.claim("call", "write_file", input(), "old")).toThrow(
    "approval",
  );
  expect(() => calls.observe("call", "write_file", input(), "old")).toThrow(
    "approval",
  );
  expect(
    calls.claim("call", "write_file", input(), "current").isCurrent(),
  ).toBe(true);
});

it("retains an executing call through its last preview read", () => {
  const calls = createFileToolCalls();
  calls.capture("call", "write_file", input(), target());
  const reader = calls.observe("call", "write_file", input());
  const execution = calls.claim("call", "write_file", input());
  execution.release();
  expect(reader.isCurrent()).toBe(false);
  expect(() => calls.capture("call", "write_file", input(), target())).toThrow(
    "duplicate",
  );
  reader.release();
  calls.capture("call", "write_file", input(), target());
  reader.release();
  execution.release();
  expect(calls.claim("call", "write_file", input()).isCurrent()).toBe(true);
});

it("counts retired previews until actual read settlement", () => {
  const calls = createFileToolCalls();
  calls.capture("old", "write_file", input(), target());
  const readers = Array.from({ length: 256 }, () =>
    calls.observe("old", "write_file", input()),
  );
  calls.retire("old");
  calls.capture("current", "write_file", input(), target());
  expect(() => calls.observe("current", "write_file", input())).toThrow(
    "Too many",
  );
  readers[0].release();
  const current = calls.observe("current", "write_file", input());
  for (const read of readers) read.release();
  expect(current.isCurrent()).toBe(true);
  current.release();
});

it("isolates child SDK call IDs while sharing the parent's physical budget", () => {
  const parent = {};
  const first = {};
  const second = {};
  inheritFileToolCalls(parent, first);
  inheritFileToolCalls(parent, second);
  const a = fileToolCallsFor(first);
  const b = fileToolCallsFor(second);
  a.capture("same", "read_file", input(), target());
  b.capture("same", "read_file", input(), {
    ...target(),
    directory: "/second",
  });
  a.retireAll();
  expect(b.preview("same", "read_file", input()).directory).toBe("/second");
  fileToolCallsFor(parent).retireAll();
  expect(() => b.preview("same", "read_file", input())).toThrow("unavailable");
});

it("cannot evade shared capacity with child owners or cancellation", () => {
  const parent = {};
  const children = Array.from({ length: 256 }, () => ({}));
  for (const child of children) {
    inheritFileToolCalls(parent, child);
    fileToolCallsFor(child).capture("same", "read_file", input(), target());
  }
  const calls = fileToolCallsFor(parent);
  const running = fileToolCallsFor(children[0]).claim(
    "same",
    "read_file",
    input(),
  );
  expect(() => calls.capture("extra", "read_file", input(), target())).toThrow(
    "Too many",
  );
  calls.retireAll();
  expect(running.isCurrent()).toBe(false);
  for (let index = 0; index < 255; index++)
    calls.capture(String(index), "read_file", input(), target());
  expect(() => calls.capture("extra", "read_file", input(), target())).toThrow(
    "Too many",
  );
  running.release();
  calls.capture("extra", "read_file", input(), target());
});

it("cannot revive an old child owner after the chat stops", () => {
  const parent = {};
  const child = {};
  inheritFileToolCalls(parent, child);
  fileToolCallsFor(child).capture("old", "read_file", input(), target());
  fileToolCallsFor(parent).retireAll();
  expect(() =>
    fileToolCallsFor(child).capture("late", "read_file", input(), target()),
  ).toThrow("retired");
  const current = {};
  inheritFileToolCalls(parent, current);
  fileToolCallsFor(current).capture("new", "read_file", input(), target());
});

it("permanently retires a finished child without retiring its parent or siblings", () => {
  const parent = {};
  const child = {};
  const sibling = {};
  inheritFileToolCalls(parent, child);
  inheritFileToolCalls(parent, sibling);
  const calls = fileToolCallsFor(child);
  calls.capture("call", "read_file", input(), target());
  const pending = calls.claim("call", "read_file", input());
  calls.retireAll();
  expect(calls.isCurrent()).toBe(false);
  expect(pending.isCurrent()).toBe(false);
  expect(() => calls.capture("late", "read_file", input(), target())).toThrow("retired");
  expect(() => inheritFileToolCalls(child, {})).toThrow("retired");
  pending.release();
  calls.retireAll();
  expect(fileToolCallsFor(parent).isCurrent()).toBe(true);
  expect(fileToolCallsFor(sibling).isCurrent()).toBe(true);
  fileToolCallsFor(sibling).capture("call", "read_file", input(), target());
});

it("matches parsed inputs independently of JSON object key order", () => {
  const calls = createFileToolCalls();
  calls.capture("call", "write_file", input(), target());
  expect(
    calls
      .claim("call", "write_file", {
        content: "fixture",
        path: "file.ts",
      })
      .isCurrent(),
  ).toBe(true);
});

it("collects the original abort listener once and never retires a replacement", () => {
  const calls = createFileToolCalls();
  let collections = 0;
  const receipt = calls.capture("call", "write_file", input(), target(), () => {
    collections++;
  });
  const execution = calls.claim("call", "write_file", input());
  receipt.retire();
  expect(collections).toBe(0);
  expect(execution.isCurrent()).toBe(false);
  execution.release();
  execution.release();
  expect(collections).toBe(1);
  calls.capture("call", "write_file", input(), target());
  receipt.retire();
  expect(calls.claim("call", "write_file", input()).isCurrent()).toBe(true);
});

it("shares captures across tool reconstruction for only the same runtime owner", () => {
  const owner = {};
  fileToolCallsFor(owner).capture("call", "write_file", input(), target());
  expect(
    fileToolCallsFor(owner).preview("call", "write_file", input()),
  ).toEqual(target());
  expect(() =>
    fileToolCallsFor({}).claim("call", "write_file", input()),
  ).toThrow("unavailable");
});

it("preserves optional undefined connection fields without rejecting the target", () => {
  const calls = createFileToolCalls();
  const source = target();
  if (source.workspace.kind === "ssh")
    source.workspace.connection.user = undefined;
  calls.capture("call", "write_file", input(), source);
  expect(calls.claim("call", "write_file", input()).target).toEqual(source);
});

it("retains the detached directory, root and filesystem before approval", () => {
  const calls = createFileToolCalls();
  const source = target();
  const original = structuredClone(source);
  const value = input();
  calls.capture("call", "write_file", value, source);
  source.directory = "/replacement";
  source.root = "/replacement";
  if (source.workspace.kind === "ssh") {
    source.workspace.sessionId = 8;
    source.workspace.connection.host = "replacement.invalid";
  }
  const preview = calls.preview("call", "write_file", value);
  expect(preview).toEqual(original);
  preview.directory = "/changed-preview";
  const execution = calls.claim("call", "write_file", value);
  expect(execution.target).toEqual(original);
  expect(execution.isCurrent()).toBe(true);
  execution.release();
  expect(execution.isCurrent()).toBe(false);
  expect(() => calls.claim("call", "write_file", value)).toThrow("unavailable");
});

it("refuses historical approvals without a runtime capture", () => {
  const calls = createFileToolCalls();
  expect(() => calls.preview("old", "write_file", input())).toThrow(
    "unavailable",
  );
  expect(() => calls.claim("old", "write_file", input())).toThrow(
    "unavailable",
  );
});

it("binds the call to its original tool and input without consuming it on mismatch", () => {
  const calls = createFileToolCalls();
  const value = input();
  calls.capture("call", "write_file", value, target());
  value.content = "changed";
  expect(() => calls.claim("call", "write_file", value)).toThrow("unavailable");
  expect(() => calls.claim("call", "edit", input())).toThrow("unavailable");
  expect(calls.claim("call", "write_file", input()).target).toEqual(target());
});

it("refuses duplicate capture and concurrent execution", () => {
  const calls = createFileToolCalls();
  calls.capture("call", "write_file", input(), target());
  expect(() => calls.capture("call", "write_file", input(), target())).toThrow(
    "duplicate",
  );
  const execution = calls.claim("call", "write_file", input());
  expect(() => calls.claim("call", "write_file", input())).toThrow(
    "already running",
  );
  execution.release();
  execution.release();
});

it("retires pending denial and abort captures without reviving them", () => {
  const calls = createFileToolCalls();
  calls.capture("denied", "write_file", input(), target());
  calls.capture("aborted", "write_file", input(), target());
  calls.retire("denied");
  calls.retire("missing");
  calls.retireAll();
  for (const id of ["denied", "aborted"])
    expect(() => calls.claim(id, "write_file", input())).toThrow("unavailable");
});

it("retains cancelled running calls in the shared quota until actual release", () => {
  const calls = createFileToolCalls();
  const running = [];
  for (let index = 0; index < 256; index++) {
    const id = String(index);
    calls.capture(id, "write_file", input(), target());
    running.push(calls.claim(id, "write_file", input()));
  }
  calls.retireAll();
  expect(running.every((execution) => !execution.isCurrent())).toBe(true);
  expect(() =>
    calls.capture("overflow", "write_file", input(), target()),
  ).toThrow("Too many");
  running[0].release();
  calls.capture("replacement", "write_file", input(), target());
  expect(() =>
    calls.capture("overflow", "write_file", input(), target()),
  ).toThrow("Too many");
  for (const execution of running) execution.release();
  expect(calls.preview("replacement", "write_file", input())).toEqual(target());
});

it("an old release cannot collect a later same-ID call", () => {
  const calls = createFileToolCalls();
  calls.capture("call", "write_file", input(), target());
  const old = calls.claim("call", "write_file", input());
  old.release();
  calls.capture("call", "write_file", input(), target());
  old.release();
  expect(calls.claim("call", "write_file", input()).isCurrent()).toBe(true);
});

it("bounds captured content and reclaims its memory only after settlement", () => {
  const calls = createFileToolCalls();
  const large = { path: "file.ts", content: "x".repeat(900_000) };
  const running = [];
  for (let index = 0; index < 9; index++) {
    const id = String(index);
    calls.capture(id, "write_file", large, target());
    running.push(calls.claim(id, "write_file", large));
  }
  calls.retireAll();
  expect(() =>
    calls.capture("overflow", "write_file", large, target()),
  ).toThrow("memory limit");
  running[0].release();
  calls.capture("replacement", "write_file", large, target());
});

it.each([
  undefined,
  Number.NaN,
  { content: "x".repeat(1024 * 1024 + 1) },
  { edits: Array.from({ length: 20_001 }, () => 1) },
  new Map(),
])(
  "rejects invalid or oversized input before reserving capacity (%#)",
  (value) => {
    const calls = createFileToolCalls();
    expect(() =>
      calls.capture("call", "write_file", value, target()),
    ).toThrow();
    calls.capture("call", "write_file", input(), target());
    expect(calls.claim("call", "write_file", input()).isCurrent()).toBe(true);
  },
);

it("rejects cyclic input without retaining a partial capture", () => {
  const calls = createFileToolCalls();
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expect(() => calls.capture("call", "write_file", cyclic, target())).toThrow(
    "Invalid",
  );
  calls.capture("call", "write_file", input(), target());
});
