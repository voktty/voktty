import { beforeEach, expect, it, vi } from "vitest";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const handle = { id: 17, token: "presentation-token" };
const scope = { schema: 1, root: "/project", blockedCount: 0 };

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === "project_memory_open") return handle;
    if (command === "project_memory_select") return "selected-token";
    if (command === "project_memory_discover") return scope;
  });
});

it("starts no IPC until selected and never initializes state during discovery", async () => {
  const owner = createNativeMemoryPresentation();
  expect(invoke).not.toHaveBeenCalled();
  const selected = await owner.select("/project", { kind: "local" });
  expect(await owner.discover(selected)).toEqual(scope);
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  await owner.initializeLocalState(selected);
  expect(invoke).toHaveBeenLastCalledWith(
    "project_memory_initialize_local_state",
    {
      handle,
      selection: "selected-token",
    },
  );
  await owner.close();
});

it("captures environment bytes and uses increasing native selection revisions", async () => {
  const opening = deferred<typeof handle>();
  invoke.mockImplementation((command: string) =>
    command === "project_memory_open"
      ? opening.promise
      : Promise.resolve("token"),
  );
  const owner = createNativeMemoryPresentation();
  const environment = { kind: "wsl" as const, distro: "original" };
  const pending = owner.select("/project", environment);
  environment.distro = "replacement";
  opening.resolve(handle);
  const first = await pending;
  await owner.select("/project", { kind: "local" });
  expect(owner.isCurrent(first)).toBe(false);
  expect(invoke).toHaveBeenCalledWith("project_memory_select", {
    handle,
    path: "/project",
    environment: { kind: "wsl", distro: "original" },
    revision: 1,
  });
  expect(invoke).toHaveBeenCalledWith("project_memory_select", {
    handle,
    path: "/project",
    environment: { kind: "local" },
    revision: 2,
  });
  await owner.close();
});

it("retires a selection round trip and rejects foreign or copied receipts", async () => {
  const owner = createNativeMemoryPresentation();
  const other = createNativeMemoryPresentation();
  const first = await owner.select("/project", { kind: "local" });
  await owner.select("/other", { kind: "local" });
  const current = await owner.select("/project", { kind: "local" });
  const foreign = await other.select("/project", { kind: "local" });
  for (const stale of [first, foreign, { ...current }]) {
    await expect(owner.discover(stale)).rejects.toMatchObject({
      code: "cancelled",
    });
  }
  expect(owner.isCurrent(current)).toBe(true);
  await owner.close();
  await other.close();
});

it("suppresses retired results and errors without issuing later initialization", async () => {
  for (const reject of [false, true]) {
    const read = deferred<typeof scope>();
    const started = deferred<void>();
    invoke.mockImplementation(async (command: string) => {
      if (command === "project_memory_open") return handle;
      if (command === "project_memory_select") return "token";
      if (command === "project_memory_discover") {
        started.resolve();
        return read.promise;
      }
    });
    const owner = createNativeMemoryPresentation();
    const selected = await owner.select("/project", { kind: "local" });
    const pending = owner.discover(selected);
    const result = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await started.promise;
    await owner.select("/replacement", { kind: "local" });
    if (reject) read.reject({ code: "unavailable" });
    else read.resolve(scope);
    await result;
    await expect(owner.initializeLocalState(selected)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "project_memory_initialize_local_state",
      ),
    ).toHaveLength(0);
    await owner.close();
  }
});

it("closes a late opening exactly once and never admits its retired select", async () => {
  const opening = deferred<typeof handle>();
  invoke.mockImplementation((command: string) =>
    command === "project_memory_open" ? opening.promise : Promise.resolve(),
  );
  const owner = createNativeMemoryPresentation();
  const pending = owner.select("/project", { kind: "local" });
  const result = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  const closing = owner.close();
  expect(owner.close()).toBe(closing);
  opening.resolve(handle);
  await result;
  await closing;
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_close",
  ]);
  await expect(
    owner.select("/project", { kind: "local" }),
  ).rejects.toMatchObject({ code: "cancelled" });
});

it("keeps cleanup retryable after failure while admission stays retired", async () => {
  const owner = createNativeMemoryPresentation();
  const selected = await owner.select("/project", { kind: "local" });
  invoke.mockRejectedValueOnce({ code: "unavailable" });
  await expect(owner.close()).rejects.toMatchObject({ code: "unavailable" });
  expect(owner.isCurrent(selected)).toBe(false);
  await owner.close();
  expect(
    invoke.mock.calls.filter(([command]) => command === "project_memory_close"),
  ).toHaveLength(2);
});

it("never lets an extra connection field change Docker into a local filesystem", async () => {
  const owner = createNativeMemoryPresentation();
  const connection = {
    containerId: "container",
    containerName: "name",
    image: "image",
    kind: "local",
  };
  await owner.select("/project", { kind: "docker", connection });
  expect(invoke).toHaveBeenCalledWith("project_memory_select", {
    handle,
    path: "/project",
    revision: 1,
    environment: {
      containerId: "container",
      containerName: "name",
      image: "image",
      kind: "docker",
    },
  });
  await owner.close();
});

it("cannot publish a late native selection over its newer receipt", async () => {
  const first = deferred<string>();
  const started = deferred<void>();
  invoke.mockImplementation(
    async (command: string, args?: { revision?: number }) => {
      if (command === "project_memory_open") return handle;
      if (command === "project_memory_select") {
        if (args?.revision === 1) {
          started.resolve();
          return first.promise;
        }
        return "new-token";
      }
      if (command === "project_memory_discover") return scope;
    },
  );
  const owner = createNativeMemoryPresentation();
  const pending = owner.select("/old", { kind: "local" });
  const result = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  const current = await owner.select("/new", { kind: "local" });
  first.resolve("old-token");
  await result;
  expect(owner.isCurrent(current)).toBe(true);
  await owner.discover(current);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_discover", {
    handle,
    selection: "new-token",
  });
  await owner.close();
});
