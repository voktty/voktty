// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { createBlankSkill } from "@/modules/harness/lib/skills";

const io = vi.hoisted(() => ({
  home: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  homeDir: io.home,
  createPath: io.create,
  writeTextFile: io.write,
  listSkills: vi.fn(),
  readTextFile: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  invalidateProjectFiles: io.invalidate,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  for (const mock of Object.values(io)) mock.mockReset();
  io.home.mockResolvedValue("/home/fixture");
  io.create.mockResolvedValue("/project/.agents/skills/review/SKILL.md");
  io.write.mockResolvedValue(undefined);
});

it("does not start a write after creation retires while native allocation is pending", async () => {
  const allocation = deferred<string>();
  io.create.mockReturnValueOnce(allocation.promise);
  const retired = new Error("Original skill dialog retired");
  let current = true;
  const pending = createBlankSkill(
    { cwd: "/project", name: "review", scope: "project" },
    () => {
      if (!current) throw retired;
    },
  );
  const result = expect(pending).rejects.toBe(retired);
  current = false;
  allocation.resolve("/project/.agents/skills/review/SKILL.md");
  await result;
  expect(io.write).not.toHaveBeenCalled();
  expect(io.invalidate).not.toHaveBeenCalled();
});

it("rejects caller retirement while resolving the personal directory", async () => {
  const home = deferred<string>();
  io.home.mockReturnValueOnce(home.promise);
  let current = true;
  const retired = new Error("Original personal creation retired");
  const pending = createBlankSkill(
    { cwd: "/project", name: "review", scope: "user" },
    () => {
      if (!current) throw retired;
    },
  );
  const result = expect(pending).rejects.toBe(retired);
  current = false;
  home.resolve("/home/fixture");
  await result;
  expect(io.create).not.toHaveBeenCalled();
});

it("creates an exclusive file and writes only while its original empty content remains", async () => {
  await createBlankSkill({ cwd: "/project", name: "review", scope: "project" });
  expect(io.create).toHaveBeenCalledExactlyOnceWith(
    "/project",
    ".agents/skills/review/SKILL.md",
    false,
  );
  expect(io.write).toHaveBeenCalledWith(
    "/project/.agents/skills/review/SKILL.md",
    expect.stringContaining("name: review"),
    "",
  );
});

it("refuses an existing file without overwriting it", async () => {
  io.create.mockRejectedValueOnce(new Error("Already exists"));
  await expect(
    createBlankSkill({ cwd: "/project", name: "review", scope: "project" }),
  ).rejects.toThrow("Already exists");
  expect(io.write).not.toHaveBeenCalled();
});

it("preserves the captured input and invalidation root across personal home lookup", async () => {
  const home = deferred<string>();
  io.home.mockReturnValueOnce(home.promise);
  const input = { cwd: "/project", name: "review", scope: "user" as const };
  const pending = createBlankSkill(input);
  input.cwd = "/replacement";
  input.name = "replacement";
  home.resolve("/home/fixture");
  await expect(pending).resolves.toBe(
    "/home/fixture/.agents/skills/review/SKILL.md",
  );
  expect(io.invalidate).toHaveBeenCalledExactlyOnceWith("/project");
});

it("does not publish completion after a pending write retires", async () => {
  const write = deferred<void>();
  io.write.mockReturnValueOnce(write.promise);
  let current = true;
  const retired = new Error("Original write retired");
  const completed = vi.fn();
  const pending = createBlankSkill(
    { cwd: "/project", name: "review", scope: "project" },
    () => {
      if (!current) throw retired;
    },
    completed,
  );
  const result = expect(pending).rejects.toBe(retired);
  await vi.waitFor(() => expect(io.write).toHaveBeenCalledOnce());
  current = false;
  write.resolve();
  await result;
  expect(completed).not.toHaveBeenCalled();
  expect(io.invalidate).not.toHaveBeenCalled();
});

it("keeps 256 retired native allocations counted until they settle", async () => {
  const allocations = Array.from({ length: 256 }, () => deferred<string>());
  for (const allocation of allocations)
    io.create.mockReturnValueOnce(allocation.promise);
  let current = true;
  const pending = Promise.allSettled(
    allocations.map((_, index) =>
      createBlankSkill(
        { cwd: "/project", name: `skill-${index}`, scope: "project" },
        () => {
          if (!current) throw new Error("retired");
        },
      ),
    ),
  );
  current = false;
  await expect(
    createBlankSkill({ cwd: "/project", name: "overflow", scope: "project" }),
  ).rejects.toThrow("capacity");
  expect(io.create).toHaveBeenCalledTimes(256);
  allocations.forEach((allocation, index) => {
    allocation.resolve(`/project/${index}/SKILL.md`);
  });
  expect(
    (await pending).every((outcome) => outcome.status === "rejected"),
  ).toBe(true);
  expect(io.write).not.toHaveBeenCalled();
  await expect(
    createBlankSkill({ cwd: "/project", name: "current", scope: "project" }),
  ).resolves.toContain("current/SKILL.md");
});
