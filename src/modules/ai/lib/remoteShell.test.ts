import { expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));

import { native } from "@/modules/ai/lib/native";

it("cancels the exact remote request on the captured session", async () => {
  let finish: (value: unknown) => void = () => {};
  io.invoke.mockImplementation((_name, args: { request: { method: string } }) =>
    args.request.method === "exec.run"
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ ok: true }),
  );
  const controller = new AbortController();
  const pending = native.remoteShellRun("sleep 30", "/srv/app", 30, {
    kind: "ssh", connection: { id: "box", name: "box", host: "box", user: "u" }, root: "/srv", sessionId: 41,
  }, controller.signal);
  controller.abort();
  const run = io.invoke.mock.calls[0][1];
  const cancel = io.invoke.mock.calls[1][1];
  expect(cancel.sessionId).toBe(41);
  expect(cancel.request.method).toBe("exec.cancel");
  expect(cancel.request.params.id).toBe(run.request.id);
  finish({ ok: true, result: {} });
  await pending;
});

it("asks for a helper update when the method is unavailable", async () => {
  io.invoke.mockResolvedValueOnce({ ok: false, error: { code: "method_not_found" } });
  await expect(native.remoteShellRun("pwd", "/srv", undefined, {
    kind: "ssh", connection: { id: "box", name: "box", host: "box", user: "u" }, root: "/srv", sessionId: 41,
  })).rejects.toThrow("Update the remote helper");
});
