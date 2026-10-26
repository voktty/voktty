import { expect, it } from "vitest";
import {
  createFileToolCalls,
  fileToolCallsFor,
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
