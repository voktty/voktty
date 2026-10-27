// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSkillActivity } from "@/modules/harness/hooks/useSkillActivity";

let root: Root, node: HTMLDivElement;
let activity: ReturnType<typeof useSkillActivity>;
const publish = vi.fn(),
  fail = vi.fn();
function Host({ context }: { context: string }) {
  activity = useSkillActivity(context);
  return null;
}
async function render(context = "original") {
  await act(async () =>
    root.render(
      <StrictMode>
        <Host context={context} />
      </StrictMode>,
    ),
  );
}
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  publish.mockClear();
  fail.mockClear();
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
it("rejects cached actions and retire callbacks after a context round trip", async () => {
  await render();
  const old = activity;
  const captured = old.capture();
  await render("other");
  await render();
  const pending = deferred(),
    task = vi.fn(() => pending.promise);
  activity.run("preview", task, publish, fail);
  old.retire("preview");
  old.run("old", task, publish, fail);
  expect(captured?.()).toBe(false);
  expect(task).toHaveBeenCalledOnce();
  await act(async () => pending.resolve("current"));
  expect(publish).toHaveBeenCalledWith("current");
});
it("coalesces a channel until settlement and preserves its successor after retirement", async () => {
  await render();
  const old = deferred(),
    next = deferred();
  const task = vi.fn(() => old.promise);
  activity.run("preview", task, publish, fail);
  activity.run("preview", task, publish, fail);
  expect(task).toHaveBeenCalledOnce();
  activity.retire("preview");
  activity.run("preview", () => next.promise, publish, fail);
  await act(async () => old.resolve("old"));
  expect(publish).not.toHaveBeenCalled();
  activity.run("preview", task, publish, fail);
  expect(task).toHaveBeenCalledOnce();
  await act(async () => next.resolve("next"));
  expect(publish).toHaveBeenCalledExactlyOnceWith("next");
});
it("retains retired requests against capacity until their physical settlement", async () => {
  await render();
  const pending = Array.from({ length: 256 }, deferred);
  for (const [index, request] of pending.entries()) {
    activity.run(String(index), () => request.promise, publish, fail);
    activity.retire(String(index));
  }
  const task = vi.fn(async () => "current");
  activity.run("overflow", task, publish, fail);
  expect(task).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
  await act(async () => {
    for (const request of pending) request.resolve("retired");
  });
  expect(publish).not.toHaveBeenCalled();
  await act(async () => activity.run("recovered", task, publish, fail));
  expect(publish).toHaveBeenCalledExactlyOnceWith("current");
});
it("reports synchronous task failures and permits a retry", async () => {
  await render();
  await act(async () =>
    activity.run(
      "preview",
      () => {
        throw new Error("read failed");
      },
      publish,
      fail,
    ),
  );
  expect(fail).toHaveBeenCalledWith(
    expect.objectContaining({ message: "read failed" }),
  );
  await act(async () =>
    activity.run("preview", async () => "retry", publish, fail),
  );
  expect(publish).toHaveBeenCalledExactlyOnceWith("retry");
});
it("discards a pending result and cached action after unmount", async () => {
  await render();
  const old = activity,
    pending = deferred(),
    task = vi.fn(async () => "late");
  activity.run("preview", () => pending.promise, publish, fail);
  await act(async () => root.render(null));
  old.run("cached", task, publish, fail);
  await act(async () => pending.resolve("old"));
  expect(task).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
