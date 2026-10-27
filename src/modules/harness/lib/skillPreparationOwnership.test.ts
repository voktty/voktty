// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { preparePrompt } from "@/modules/harness/lib/promptPreparation";
import {
  applySkillsToTurn,
  invalidateSkills,
  readSkillBody,
  type FileSkill,
} from "@/modules/harness/lib/skills";
import type { DiscoveredSkill } from "@/modules/harness/lib/fs";

const io = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }));
vi.mock("@/modules/harness/lib/fs", () => ({
  listSkills: io.list,
  readTextFile: io.read,
  createPath: vi.fn(),
  writeTextFile: vi.fn(),
  homeDir: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileMentions", () => ({
  applyFileMentionsToTurn: async (text: string) => text,
}));
vi.mock("@/modules/harness/lib/notes", () => ({
  applyNotesToTurn: async (text: string) => text,
}));

const context = { harness: "claude" as const, cwd: "/project" };
const discovered: DiscoveredSkill = {
  name: "review",
  description: "Review code",
  path: "/project/.agents/skills/review/SKILL.md",
  scope: "project",
  source: "agents",
};
const skill: FileSkill = {
  ...discovered,
  kind: "file",
  scope: "project",
  invocation: "review",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  localStorage.clear();
  invalidateSkills();
  io.list.mockReset().mockResolvedValue([discovered]);
  io.read.mockReset().mockResolvedValue("Original instructions");
});
afterEach(() => {
  invalidateSkills();
  localStorage.clear();
});

it("does not start a skill body read after the real prompt caller retires during catalog loading", async () => {
  const catalog = deferred<DiscoveredSkill[]>();
  io.list.mockReturnValueOnce(catalog.promise);
  const retired = new Error("Original preparation retired");
  let current = true;
  const pending = preparePrompt("/review inspect", context, () => {
    if (!current) throw retired;
  });
  const result = expect(pending).rejects.toBe(retired);
  await vi.waitFor(() => expect(io.list).toHaveBeenCalledOnce());
  current = false;
  catalog.resolve([discovered]);
  await result;
  expect(io.read).not.toHaveBeenCalled();
});

it("does not turn caller retirement during a failed body read into fallback instructions", async () => {
  const body = deferred<string>();
  io.read.mockReturnValueOnce(body.promise);
  const retired = new Error("Original body read retired");
  let current = true;
  const pending = readSkillBody(skill, () => {
    if (!current) throw retired;
  });
  const result = expect(pending).rejects.toBe(retired);
  current = false;
  body.reject(new Error("Old read failure"));
  await result;
});

it("rejects a retired body result instead of injecting its completed text", async () => {
  const body = deferred<string>();
  io.read.mockReturnValueOnce(body.promise);
  let current = true;
  const retired = new Error("Original result retired");
  const pending = applySkillsToTurn("/review inspect", context, () => {
    if (!current) throw retired;
  });
  const result = expect(pending).rejects.toBe(retired);
  await vi.waitFor(() => expect(io.read).toHaveBeenCalledOnce());
  current = false;
  body.resolve("Old instructions");
  await result;
});

it("retains parallel reads until every admitted body settles after retirement", async () => {
  const first = deferred<string>(),
    second = deferred<string>();
  io.list.mockResolvedValueOnce([
    discovered,
    {
      ...discovered,
      name: "deploy",
      path: "/project/.agents/skills/deploy/SKILL.md",
    },
  ]);
  io.read
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  let current = true;
  const observed = deferred<void>();
  const retired = new Error("Original parallel reads retired");
  let settled = false;
  const pending = preparePrompt("/review /deploy inspect", context, () => {
    if (!current) {
      observed.resolve();
      throw retired;
    }
  }).then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2));
  current = false;
  first.resolve("First body");
  await observed.promise;
  await vi.dynamicImportSettled();
  expect(settled).toBe(false);
  second.resolve("Second body");
  await expect(pending).resolves.toBe(retired);
});

it("checks the caller before starting another body after reentrant retirement", async () => {
  io.list.mockResolvedValueOnce([
    discovered,
    {
      ...discovered,
      name: "deploy",
      path: "/project/.agents/skills/deploy/SKILL.md",
    },
  ]);
  let current = true;
  const retired = new Error("Original read admission retired");
  io.read.mockImplementationOnce(async () => {
    current = false;
    return "First body";
  });
  await expect(
    applySkillsToTurn("/review /deploy inspect", context, () => {
      if (!current) throw retired;
    }),
  ).rejects.toBe(retired);
  expect(io.read).toHaveBeenCalledExactlyOnceWith(discovered.path);
});

it("keeps another caller of a shared catalog active when one prompt retires", async () => {
  const catalog = deferred<DiscoveredSkill[]>();
  io.list.mockReturnValueOnce(catalog.promise);
  let current = true;
  const retired = new Error("Only the first prompt retired");
  const first = preparePrompt("/review first", context, () => {
    if (!current) throw retired;
  });
  const firstResult = expect(first).rejects.toBe(retired);
  const second = preparePrompt("/review second", context);
  await vi.waitFor(() => expect(io.list).toHaveBeenCalledOnce());
  current = false;
  catalog.resolve([discovered]);
  await firstResult;
  await expect(second).resolves.toContain("Original instructions");
  expect(io.read).toHaveBeenCalledExactlyOnceWith(discovered.path);
});

it("keeps ordinary read-error fallback and its original skill identity", async () => {
  const body = deferred<string>();
  io.read.mockReturnValueOnce(body.promise);
  const input = { ...skill };
  const pending = readSkillBody(input);
  input.name = "replacement";
  input.path = "/replacement/SKILL.md";
  body.reject(new Error("Missing file"));
  await expect(pending).resolves.toBe(
    `Skill "review" could not be read from ${skill.path}.`,
  );
  expect(io.read).toHaveBeenCalledExactlyOnceWith(skill.path);
});

it("does not hide a post-read guard rejection that only throws once", async () => {
  const retired = new Error("Original body receipt retired");
  let checking = 0;
  await expect(
    readSkillBody(skill, () => {
      if (++checking === 2) throw retired;
    }),
  ).rejects.toBe(retired);
});

it.each(["/create-skill inspect", "hello"])(
  "keeps current builtin and plain preparation for %s",
  async (text) => {
    const result = await preparePrompt(text, context);
    expect(result).toContain(text);
    expect(io.read).not.toHaveBeenCalled();
  },
);
