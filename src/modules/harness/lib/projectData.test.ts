// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createPersistenceAdmission,
  windowPersistenceAdmission,
  type PersistenceFinal,
} from "@/modules/harness/lib/persistenceAdmission";
import { removeProjectData } from "@/modules/harness/lib/projectData";

const storage = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  logo: vi.fn(),
  background: vi.fn(),
  setting: vi.fn(),
  tabs: vi.fn(),
  group: vi.fn(),
  remote: vi.fn(),
}));
vi.mock("@/modules/harness/lib/sessionStore", () => ({
  listSessionsByProject: storage.list,
  deleteSession: storage.remove,
}));
vi.mock("@/modules/harness/lib/projectLogos", () => ({
  clearProjectLogo: storage.logo,
}));
vi.mock("@/modules/harness/lib/chatBackground", () => ({
  clearProjectChatBackground: storage.background,
}));
vi.mock("@/modules/harness/lib/projectChatBackground", () => ({
  clearProjectChatBackgroundSetting: storage.setting,
}));
vi.mock("@/modules/harness/lib/tabGroups", () => ({
  clearTabGroupSettings: storage.tabs,
}));
vi.mock("@/modules/harness/lib/projectGroups", () => ({
  removeProjectGroupAssignment: storage.group,
}));
vi.mock("@/modules/connections/model/remoteProjects", () => ({
  forgetRemoteProject: storage.remote,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const admission = createPersistenceAdmission();
  const owner = admission.createOwner();
  const permit = owner.capture();
  if (!permit) throw new Error("Missing project permit");
  return { owner, permit };
}
let final: PersistenceFinal | null;
beforeEach(() => {
  final = null;
  for (const mock of Object.values(storage)) mock.mockReset();
  storage.list.mockResolvedValue([{ id: "one" }, { id: "two" }]);
  storage.remove.mockResolvedValue(undefined);
  storage.logo.mockResolvedValue(undefined);
  storage.background.mockResolvedValue(undefined);
});
afterEach(() => final?.cancel());
function noAppearanceWrites() {
  for (const mock of [
    storage.logo,
    storage.background,
    storage.setting,
    storage.tabs,
    storage.group,
    storage.remote,
  ])
    expect(mock).not.toHaveBeenCalled();
}

it("removes local conversations and project appearance under current admission", async () => {
  const f = fixture();
  expect(await removeProjectData("/work/app/", f.permit)).toBe(true);
  expect(storage.list).toHaveBeenCalledWith("/work/app");
  expect(storage.remove.mock.calls).toEqual([["one"], ["two"]]);
  for (const mock of [
    storage.logo,
    storage.background,
    storage.setting,
    storage.tabs,
    storage.group,
    storage.remote,
  ])
    expect(mock).toHaveBeenCalledOnce();
});

it("keeps remote conversations in the project while clearing local appearance", async () => {
  const f = fixture();
  expect(await removeProjectData("remote://host/work/app", f.permit)).toBe(
    true,
  );
  expect(storage.list).not.toHaveBeenCalled();
  expect(storage.remove).not.toHaveBeenCalled();
  expect(storage.remote).toHaveBeenCalledWith("remote://host/work/app");
});

it("does not start metadata reads or writes under a retired permit", async () => {
  const f = fixture();
  f.owner.retire();
  expect(await removeProjectData("/work/app", f.permit)).toBe(false);
  expect(storage.list).not.toHaveBeenCalled();
  expect(storage.remove).not.toHaveBeenCalled();
  noAppearanceWrites();
});

it("keeps metadata reads outside the drain and rejects late results after close cancellation", async () => {
  const f = fixture();
  const gate = deferred<Array<{ id: string }>>();
  storage.list.mockReturnValue(gate.promise);
  const pending = removeProjectData("/work/app", f.permit);
  final = f.permit.seal();
  expect(final).not.toBeNull();
  expect(final?.pending).toBeNull();
  final?.cancel();
  gate.resolve([{ id: "late" }]);
  expect(await pending).toBe(false);
  expect(storage.remove).not.toHaveBeenCalled();
  noAppearanceWrites();
});

it("drains an accepted deletion through settlement but never deletes the next conversation after cancellation", async () => {
  const f = fixture();
  const gate = deferred<void>();
  storage.remove.mockReturnValueOnce(gate.promise);
  const pending = removeProjectData("/work/app", f.permit);
  await vi.waitFor(() => expect(storage.remove).toHaveBeenCalledWith("one"));
  final = f.permit.seal();
  expect(final?.pending).not.toBeNull();
  let drained = false;
  void final?.pending?.then(() => {
    drained = true;
  });
  final?.cancel();
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve();
  expect(await pending).toBe(false);
  await final?.pending;
  expect(drained).toBe(true);
  expect(storage.remove).toHaveBeenCalledOnce();
  noAppearanceWrites();
});

it("revalidates between synchronous appearance writers after reentrant retirement", async () => {
  const f = fixture();
  storage.setting.mockImplementation(() => f.owner.retire());
  expect(await removeProjectData("/work/app", f.permit)).toBe(false);
  expect(storage.setting).toHaveBeenCalledOnce();
  expect(storage.tabs).not.toHaveBeenCalled();
  expect(storage.group).not.toHaveBeenCalled();
  expect(storage.remote).not.toHaveBeenCalled();
});

it("preserves best-effort cleanup when an admitted storage operation fails", async () => {
  const f = fixture();
  storage.remove.mockRejectedValueOnce(new Error("Storage failed"));
  storage.logo.mockRejectedValueOnce(new Error("Logo failed"));
  expect(await removeProjectData("/work/app", f.permit)).toBe(true);
  expect(storage.remove).toHaveBeenCalledTimes(2);
  expect(storage.remote).toHaveBeenCalledOnce();
});

it("fences the existing caller without an explicit permit through the window authority", async () => {
  const owner = windowPersistenceAdmission.createOwner();
  const gate = deferred<Array<{ id: string }>>();
  storage.list.mockReturnValue(gate.promise);
  const pending = removeProjectData("/work/app");
  final = owner.capture()?.seal() ?? null;
  expect(final).not.toBeNull();
  final?.cancel();
  gate.resolve([{ id: "late" }]);
  expect(await pending).toBe(false);
  expect(storage.remove).not.toHaveBeenCalled();
  noAppearanceWrites();
  owner.retire();
});

it("retains its temporary window owner until a successful default call settles", async () => {
  expect(await removeProjectData("/work/app")).toBe(true);
  expect(storage.remove.mock.calls).toEqual([["one"], ["two"]]);
  expect(storage.remote).toHaveBeenCalledWith("/work/app");
});

it("deletes captured live IDs even before their first save appears in metadata", async () => {
  const f = fixture();
  const ids = ["unsaved"];
  const gate = deferred<Array<{ id: string }>>();
  storage.list.mockReturnValue(gate.promise);
  const pending = removeProjectData("/work/app", f.permit, ids);
  ids[0] = "later-mutation";
  gate.resolve([]);
  expect(await pending).toBe(true);
  expect(storage.remove.mock.calls).toEqual([["unsaved"]]);
});

it("never deletes remote live IDs and validates local raw capacity before metadata reads", async () => {
  const f = fixture();
  expect(
    await removeProjectData("remote://host/work/app", f.permit, [
      "remote-live",
    ]),
  ).toBe(true);
  expect(storage.remove).not.toHaveBeenCalled();
  await expect(
    removeProjectData("/work/app", f.permit, Array(257).fill("duplicate")),
  ).rejects.toThrow(TypeError);
  expect(storage.list).not.toHaveBeenCalled();
});
