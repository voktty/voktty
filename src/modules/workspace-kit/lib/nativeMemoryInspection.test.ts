import { beforeEach, expect, it, vi } from "vitest";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const handle = { id: 1, token: "presentation" };
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === "project_memory_open") return handle;
    if (command === "project_memory_select") return "selection";
  });
});

it("never requests ancestor inspection by default and does not retain consent on later selections", async () => {
  const owner = createNativeMemoryPresentation();
  await owner.select("/project", { kind: "local" });
  expect(invoke).toHaveBeenLastCalledWith("project_memory_select", {
    handle,
    path: "/project",
    environment: { kind: "local" },
    revision: 1,
  });
  const inspected = await owner.select(
    "/project",
    { kind: "local" },
    { inspectAncestors: true },
  );
  expect(invoke).toHaveBeenLastCalledWith("project_memory_select", {
    handle,
    path: "/project",
    environment: { kind: "local" },
    revision: 2,
    inspectAncestors: true,
  });
  await owner.select("/project", { kind: "local" });
  expect(owner.isCurrent(inspected)).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_select", {
    handle,
    path: "/project",
    environment: { kind: "local" },
    revision: 3,
  });
  await owner.close();
});

it("captures explicit inspection before opening and cannot deliver an old selection after it", async () => {
  let open!: (value: typeof handle) => void;
  const opening = new Promise<typeof handle>((resolve) => {
    open = resolve;
  });
  invoke.mockImplementation((command: string) =>
    command === "project_memory_open" ? opening : Promise.resolve("selection"),
  );
  const owner = createNativeMemoryPresentation();
  const options = { inspectAncestors: true };
  const selected = owner.select("/project", { kind: "local" }, options);
  options.inspectAncestors = false;
  open(handle);
  const receipt = await selected;
  expect(invoke).toHaveBeenLastCalledWith("project_memory_select", {
    handle,
    path: "/project",
    environment: { kind: "local" },
    revision: 1,
    inspectAncestors: true,
  });
  await owner.select("/elsewhere", { kind: "local" });
  await expect(owner.discover(receipt)).rejects.toMatchObject({
    code: "cancelled",
  });
  await owner.close();
});
