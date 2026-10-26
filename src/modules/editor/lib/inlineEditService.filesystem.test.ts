import { beforeEach, expect, it, vi } from "vitest";
import { requestInlineEdit } from "@/modules/editor/lib/inlineEditService";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  model: vi.fn(),
  generate: vi.fn(),
  workspace: { kind: "local" },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/ai/lib/agent", () => ({
  buildConfiguredLanguageModel: io.model,
}));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  requireAiRuntime: vi.fn(),
}));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: {
    getState: () => ({ apiKeys: {}, selectedModelId: "fixture" }),
  },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ sshConnections: [] }) },
}));
vi.mock("@/modules/workspace", async (original) => ({
  ...(await original<typeof import("@/modules/workspace")>()),
  currentWorkspaceEnv: () => io.workspace,
}));
vi.mock("ai", () => ({ generateText: io.generate }));

beforeEach(() => {
  vi.clearAllMocks();
  io.workspace = { kind: "local" };
  io.model.mockResolvedValue({});
  io.generate.mockResolvedValue({ text: "replacement" });
  io.invoke.mockImplementation(
    async (command: string, args: { path: string }) => {
      if (command === "fs_canonicalize") return args.path;
      if (command === "fs_stat") return { size: 10, kind: "file", mtime: 1 };
      return { kind: "text", content: "reference", size: 10 };
    },
  );
});

it("keeps the document filesystem and resolves references before an ambient switch", async () => {
  let finish!: (model: object) => void;
  io.model.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const params = {
    instruction: "use @helper.ts",
    code: "target",
    path: "/work/main.ts",
    workspaceEnv: { kind: "local" as const },
  };
  const request = requestInlineEdit(params);
  io.workspace = { kind: "wsl", distro: "Other" } as typeof io.workspace;
  finish({});
  await request;
  expect(io.invoke).toHaveBeenCalledWith(
    "fs_read_file",
    expect.objectContaining({
      path: "/work/helper.ts",
      workspace: { kind: "local" },
    }),
  );
  expect(io.generate.mock.calls[0][0].prompt).toContain("reference");
});

it("does not read references or submit generation after cancellation during model setup", async () => {
  let finish!: (model: object) => void;
  io.model.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const params = {
    instruction: "use @helper.ts",
    code: "target",
    path: "/work/main.ts",
    workspaceEnv: { kind: "local" as const },
  };
  const request = requestInlineEdit(params, undefined, controller.signal);
  const rejected = expect(request).rejects.toThrow();
  controller.abort();
  finish({});
  await rejected;
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.generate).not.toHaveBeenCalled();
});

it("snapshots instruction and target code before model setup settles", async () => {
  let finish!: (model: object) => void;
  io.model.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const params = {
    instruction: "original",
    code: "original target",
    path: "/work/main.ts",
    workspaceEnv: { kind: "local" as const },
  };
  const request = requestInlineEdit(params);
  params.instruction = "mutated @other.ts";
  params.code = "mutated target";
  finish({});
  await request;
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.generate.mock.calls[0][0].prompt).toContain("original target");
  expect(io.generate.mock.calls[0][0].prompt).not.toContain("mutated");
});

it("limits referenced context to sixteen files and four thousand characters each", async () => {
  io.invoke.mockImplementation(
    async (command: string, args: { path: string }) => {
      if (command === "fs_canonicalize") return args.path;
      if (command === "fs_stat") return { kind: "file", size: 5000 };
      return { kind: "text", content: "x".repeat(5000), size: 5000 };
    },
  );
  await requestInlineEdit({
    instruction: Array.from(
      { length: 20 },
      (_, index) => `@file${index}.ts`,
    ).join(" "),
    code: "target",
    path: "/work/main.ts",
    workspaceEnv: { kind: "local" },
  });
  expect(
    io.invoke.mock.calls.filter(([command]) => command === "fs_read_file"),
  ).toHaveLength(16);
  const prompt = io.generate.mock.calls[0][0].prompt as string;
  expect(prompt.match(/\[Referenced File:/g)).toHaveLength(16);
  expect(prompt).not.toContain("x".repeat(4001));
});

it("retains cancelled model setups in its shared budget until settlement", async () => {
  const finishes: Array<(model: object) => void> = [];
  io.model.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  const controller = new AbortController();
  const params = {
    instruction: "fixture",
    code: "target",
    path: "/work/main.ts",
    workspaceEnv: { kind: "local" as const },
  };
  const cohort = Promise.allSettled(
    Array.from({ length: 256 }, () =>
      requestInlineEdit(params, undefined, controller.signal),
    ),
  );
  controller.abort();
  await expect(requestInlineEdit(params)).rejects.toThrow("capacity");
  for (const finish of finishes) finish({});
  expect((await cohort).every((result) => result.status === "rejected")).toBe(
    true,
  );
  expect(io.generate).not.toHaveBeenCalled();
  io.model.mockResolvedValue({});
  await expect(requestInlineEdit(params)).resolves.toBe("replacement");
});
