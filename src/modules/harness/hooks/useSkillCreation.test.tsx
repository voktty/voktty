// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSkillCreation } from "@/modules/harness/hooks/useSkillCreation";

const io = vi.hoisted(() => ({
  allocate: vi.fn(),
  write: vi.fn(),
  complete: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  createPath: io.allocate,
  writeTextFile: io.write,
  homeDir: async () => "/home/fixture",
  listSkills: vi.fn(),
  readTextFile: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
}));
let root: Root, node: HTMLDivElement;
let creation: ReturnType<typeof useSkillCreation>;
const context = {};
function Host(props: {
  cwd?: string;
  open?: boolean;
  context?: object;
  onCreated?: typeof io.complete;
}) {
  creation = useSkillCreation({
    cwd: props.cwd ?? "/project",
    open: props.open ?? true,
    context: props.context ?? context,
    onCreated: props.onCreated ?? io.complete,
  });
  return null;
}
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function render(props: Parameters<typeof Host>[0] = {}) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Host {...props} />
      </StrictMode>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of Object.values(io)) mock.mockReset();
  io.allocate.mockResolvedValue("/project/.agents/skills/review/SKILL.md");
  io.write.mockResolvedValue(undefined);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("coalesces duplicate submits before React publishes busy", async () => {
  const allocation = deferred();
  io.allocate.mockReturnValueOnce(allocation.promise);
  await render();
  await act(async () => {
    creation.create("review", "project");
    creation.create("review", "project");
  });
  expect(io.allocate).toHaveBeenCalledOnce();
  expect(creation.busy).toBe(true);
  await act(async () =>
    allocation.resolve("/project/.agents/skills/review/SKILL.md"),
  );
  expect(io.write).toHaveBeenCalledOnce();
  expect(io.complete).toHaveBeenCalledOnce();
  expect(creation.busy).toBe(false);
});

it.each([
  "cancel",
  "context",
  "cwd",
  "closed",
  "unmount",
  "roundtrip",
] as const)(
  "retires creation after %s without starting write",
  async (reason) => {
    const allocation = deferred();
    io.allocate.mockReturnValueOnce(allocation.promise);
    await render();
    const old = creation.create;
    await act(async () => old("review", "project"));
    if (reason === "cancel") await act(async () => creation.cancel());
    if (reason === "context") await render({ context: {} });
    if (reason === "cwd") await render({ cwd: "/replacement" });
    if (reason === "closed") await render({ open: false });
    if (reason === "unmount") await act(async () => root.render(null));
    if (reason === "roundtrip") {
      await render({ cwd: "/replacement" });
      await render();
    }
    await act(async () =>
      allocation.resolve("/project/.agents/skills/review/SKILL.md"),
    );
    expect(io.write).not.toHaveBeenCalled();
    expect(io.complete).not.toHaveBeenCalled();
    await act(async () => old("cached", "project"));
    expect(io.allocate).toHaveBeenCalledOnce();
  },
);

it("uses the original completion callback across ordinary rerenders", async () => {
  const allocation = deferred();
  io.allocate.mockReturnValueOnce(allocation.promise);
  await render();
  await act(async () => creation.create("review", "project"));
  const replacement = vi.fn();
  await render({ onCreated: replacement });
  await act(async () =>
    allocation.resolve("/project/.agents/skills/review/SKILL.md"),
  );
  expect(io.complete).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});

it("does not clear a successor's busy state when an older cancelled creation settles", async () => {
  const first = deferred(),
    second = deferred();
  io.allocate
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await render();
  await act(async () => creation.create("review", "project"));
  await act(async () => creation.cancel());
  await act(async () => creation.create("deploy", "project"));
  await act(async () =>
    first.resolve("/project/.agents/skills/review/SKILL.md"),
  );
  expect(creation.busy).toBe(true);
  expect(io.write).not.toHaveBeenCalled();
  await act(async () =>
    second.resolve("/project/.agents/skills/deploy/SKILL.md"),
  );
  expect(io.complete).toHaveBeenCalledOnce();
  expect(creation.busy).toBe(false);
});

it("exposes a current failure and allows an explicit retry", async () => {
  io.allocate.mockRejectedValueOnce(new Error("Creation failed"));
  await render();
  await act(async () => creation.create("review", "project"));
  expect(creation.error).toBe("Creation failed");
  expect(creation.busy).toBe(false);
  await act(async () => creation.create("review", "project"));
  expect(creation.error).toBeNull();
  expect(io.complete).toHaveBeenCalledOnce();
});
