// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSourceControlPanel } from "@/modules/source-control/useSourceControlPanel";
import { generateSemanticStagingGroups } from "@/modules/source-control/lib/semanticStaging";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  diff: vi.fn(),
  model: vi.fn(),
  generate: vi.fn(),
  stage: vi.fn(),
  unstage: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitDiff: mocks.diff,
    gitStage: mocks.stage,
    gitUnstage: mocks.unstage,
  },
}));
vi.mock("@/modules/ai/lib/agent", () => ({
  buildConfiguredLanguageModel: mocks.model,
}));
vi.mock("ai", () => ({ generateText: mocks.generate }));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  isAiRuntimeAvailable: () => true,
  requireAiRuntime: () => {},
}));
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  sessionId: 7,
  connection: { id: "build", name: "Build", host: "build.example" },
};
const groupText = JSON.stringify([
  {
    type: "fix",
    scope: null,
    message: "fix: generated",
    files: ["src/file.ts"],
    reason: "change",
  },
]);
const previousEnv = useWorkspaceEnvStore.getState().env;
const previousChat = useChatStore.getState();
const previousPreferences = usePreferencesStore.getState();
type Mode = "message" | "groups";
let root: Root;
let panel: ReturnType<typeof useSourceControlPanel>;
let value: SourceControlSummary;
function Probe({ open = true }: { open?: boolean }) {
  panel = useSourceControlPanel(open, value, null);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function start(mode: Mode) {
  return mode === "message"
    ? panel.generateCommitMessage()
    : panel.generateSemanticGroups();
}
function response(mode: Mode) {
  return { text: mode === "message" ? "fix: generated" : groupText };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.diff.mockReset().mockResolvedValue({ diffText: "+original" });
  mocks.model.mockReset().mockResolvedValue({ id: "test-model" });
  mocks.generate
    .mockReset()
    .mockImplementation(async (input: { system: string }) => ({
      text: input.system.includes("semantic staging")
        ? groupText
        : "fix: generated",
    }));
  mocks.stage.mockReset().mockResolvedValue(undefined);
  mocks.unstage.mockReset().mockResolvedValue(undefined);
  useWorkspaceEnvStore.setState({ env: ssh });
  useChatStore.setState({
    selectedModelId: "gpt-6.1-sol",
    apiKeys: { ...previousChat.apiKeys, openai: "test-original" },
    agentMeta: { ...previousChat.agentMeta, status: "idle" },
  });
  usePreferencesStore.setState({
    language: "en",
    gitCommitMessageUseEditorLanguage: true,
  });
  value = {
    contextPath: "/project",
    repo: {
      repoRoot: "/project",
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: {
      repoRoot: "/project",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      truncated: false,
      isDetached: false,
      changedFiles: [
        {
          path: "src/file.ts",
          originalPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          staged: true,
          unstaged: false,
          untracked: false,
          conflicted: false,
          statusLabel: "Modified",
        },
      ],
    },
    changedCount: 1,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasRepo: true,
    isLoading: false,
    localError: null,
    dubiousOwnershipPath: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: vi.fn(),
    refresh: vi.fn(async () => {}),
    trustRepository: vi.fn(async () => {}),
    initRepository: vi.fn(async () => {}),
    undoCommit: vi.fn(async () => true),
    runRemoteAction: vi.fn(async () => ({ ok: false, action: null })),
  };
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceEnvStore.setState({ env: previousEnv });
  useChatStore.setState(previousChat);
  usePreferencesStore.setState(previousPreferences);
  vi.unstubAllGlobals();
});
it.each<Mode>(["message", "groups"])(
  "generates current %s with its explicit filesystem",
  async (mode) => {
    await act(async () => root.render(<Probe />));
    await act(async () => start(mode));
    expect(mocks.diff).toHaveBeenCalledExactlyOnceWith(
      "/project",
      null,
      mode === "message",
      ssh,
    );
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    if (mode === "message") expect(panel.commitMessage).toBe("fix: generated");
    else {
      expect(panel.semanticGroups).toHaveLength(1);
      expect(panel.semanticStagingOpen).toBe(true);
    }
  },
);
it.each<Mode>(["message", "groups"])(
  "does not start cached %s generation after close",
  async (mode) => {
    await act(async () => root.render(<Probe />));
    const run =
      mode === "message"
        ? panel.generateCommitMessage
        : panel.generateSemanticGroups;
    await act(async () => root.render(<Probe open={false} />));
    await act(async () => run());
    expect(mocks.diff).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  },
);
it.each<Mode>(["message", "groups"])(
  "does not configure or generate %s after its diff retires",
  async (mode) => {
    const pending = deferred<{ diffText: string }>();
    mocks.diff.mockReturnValue(pending.promise);
    await act(async () => root.render(<Probe />));
    let operation!: Promise<void>;
    await act(async () => {
      operation = start(mode);
    });
    await act(async () => root.render(<Probe open={false} />));
    await act(async () => {
      pending.resolve({ diffText: "+old" });
      await operation;
    });
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  },
);
it.each<Mode>(["message", "groups"])(
  "does not request %s after model construction retires",
  async (mode) => {
    const pending = deferred<{ id: string }>();
    mocks.model.mockReturnValue(pending.promise);
    await act(async () => root.render(<Probe />));
    let operation!: Promise<void>;
    await act(async () => {
      operation = start(mode);
    });
    await vi.waitFor(() => expect(mocks.model).toHaveBeenCalledTimes(1));
    await act(async () => root.render(<Probe open={false} />));
    await act(async () => {
      pending.resolve({ id: "retired" });
      await operation;
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  },
);
it.each<Mode>(["message", "groups"])(
  "suppresses late %s results and repair requests",
  async (mode) => {
    const pending = deferred<{ text: string }>();
    mocks.generate.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Probe />));
    let operation!: Promise<void>;
    await act(async () => {
      operation = start(mode);
    });
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    await act(async () => root.render(<Probe open={false} />));
    await act(async () => {
      pending.resolve(mode === "message" ? { text: "" } : response(mode));
      await operation;
    });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(panel.commitMessage).toBe("");
    expect(panel.semanticGroups).toEqual([]);
    expect(panel.actionError).toBeNull();
  },
);
it.each<Mode>(["message", "groups"])(
  "shares pending admission between %s generation and mutations",
  async (mode) => {
    const pending = deferred<{ diffText: string }>();
    mocks.diff.mockReturnValue(pending.promise);
    await act(async () => root.render(<Probe />));
    const operations: Promise<void>[] = [];
    await act(async () => {
      operations.push(
        start(mode),
        start(mode),
        start(mode === "message" ? "groups" : "message"),
        panel.unstageAllEntries(),
      );
    });
    expect(mocks.diff).toHaveBeenCalledTimes(1);
    expect(mocks.unstage).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ diffText: "+original" });
      await Promise.all(operations);
    });
  },
);
it.each<Mode>(["message", "groups"])(
  "snapshots %s input before the diff await",
  async (mode) => {
    const pending = deferred<{ diffText: string }>();
    mocks.diff.mockReturnValue(pending.promise);
    await act(async () => root.render(<Probe />));
    let operation!: Promise<void>;
    const entry =
      mode === "message" ? panel.stagedEntries[0] : panel.fileEntries[0];
    await act(async () => {
      operation = start(mode);
    });
    entry.path = "changed.ts";
    await act(async () => {
      useChatStore.setState({
        apiKeys: { ...previousChat.apiKeys, openai: "test-replacement" },
      });
      usePreferencesStore.setState({ language: "es" });
    });
    await act(async () => {
      pending.resolve({ diffText: "+original" });
      await operation;
    });
    expect(mocks.model.mock.calls[0][1].openai).toBe("test-original");
    expect(mocks.generate.mock.calls[0][0].prompt).toContain("src/file.ts");
    expect(mocks.generate.mock.calls[0][0].prompt).not.toContain("changed.ts");
    if (mode === "message")
      expect(mocks.generate.mock.calls[0][0].system).toContain("English");
  },
);
it.each<Mode>(["message", "groups"])(
  "preserves a successor's busy state after retired %s generation",
  async (mode) => {
    const first = deferred<{ text: string }>();
    const next = deferred<{ text: string }>();
    mocks.generate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(next.promise);
    await act(async () => root.render(<Probe />));
    let old!: Promise<void>;
    await act(async () => {
      old = start(mode);
    });
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    await act(async () => root.render(<Probe open={false} />));
    await act(async () => root.render(<Probe />));
    let current!: Promise<void>;
    await act(async () => {
      current = start(mode);
    });
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
    await act(async () => {
      first.resolve(response(mode));
      await old;
    });
    expect(panel.actionBusy).toBe(
      mode === "message" ? "generate-message" : "semantic-staging",
    );
    await act(async () => {
      next.resolve(response(mode));
      await current;
    });
    expect(panel.actionBusy).toBeNull();
  },
);
it.each<Mode>(["message", "groups"])(
  "suppresses retired %s errors",
  async (mode) => {
    const pending = deferred<{ text: string }>();
    mocks.generate.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Probe />));
    let operation!: Promise<void>;
    await act(async () => {
      operation = start(mode);
    });
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    await act(async () => root.render(<Probe open={false} />));
    await act(async () => {
      pending.reject(new Error("Retired generation failed"));
      await operation;
    });
    expect(panel.actionError).toBeNull();
  },
);
it.each<Mode>(["message", "groups"])(
  "keeps a current %s generation error visible",
  async (mode) => {
    mocks.generate.mockRejectedValue(new Error("Generation refused"));
    await act(async () => root.render(<Probe />));
    await act(async () => start(mode));
    expect(panel.actionError).toBe("Generation refused");
    expect(panel.actionBusy).toBeNull();
  },
);
it("preserves semantic generation's empty-diff fallback", async () => {
  mocks.diff.mockRejectedValue(new Error("No textual diff"));
  await act(async () => root.render(<Probe />));
  await act(async () => start("groups"));
  expect(panel.actionError).toBeNull();
  expect(panel.semanticGroups).toHaveLength(1);
  expect(mocks.generate.mock.calls[0][0].prompt).toContain(
    "Diff summary not available",
  );
});
it("does not request a commit message when its current diff fails", async () => {
  mocks.diff.mockRejectedValue(new Error("Diff refused"));
  await act(async () => root.render(<Probe />));
  await act(async () => start("message"));
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(panel.actionError).toBe("Diff refused");
});
it("preserves the existing commit-message repair", async () => {
  mocks.generate
    .mockResolvedValueOnce({ text: "" })
    .mockResolvedValueOnce({ text: "fix: repaired" });
  await act(async () => root.render(<Probe />));
  await act(async () => start("message"));
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  expect(panel.commitMessage).toBe("fix: repaired");
});
it("suppresses a repair result after its owner retires", async () => {
  const pending = deferred<{ text: string }>();
  mocks.generate
    .mockResolvedValueOnce({ text: "" })
    .mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Probe />));
  let operation!: Promise<void>;
  await act(async () => {
    operation = start("message");
  });
  await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
  await act(async () => root.render(<Probe open={false} />));
  await act(async () => {
    pending.resolve({ text: "fix: retired repair" });
    await operation;
  });
  expect(panel.commitMessage).toBe("");
});
it("retires published semantic groups when the panel closes", async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => start("groups"));
  expect(panel.semanticGroups).toHaveLength(1);
  await act(async () => root.render(<Probe open={false} />));
  expect(panel.semanticGroups).toEqual([]);
  expect(panel.semanticStagingOpen).toBe(false);
});
it.each<Mode>(["message", "groups"])(
  "does not resume %s generation after a batched filesystem round trip",
  async (mode) => {
    const pending = deferred<{ diffText: string }>();
    mocks.diff.mockReturnValue(pending.promise);
    await act(async () => root.render(<Probe />));
    let operation!: Promise<void>;
    await act(async () => {
      operation = start(mode);
    });
    await act(async () => {
      useWorkspaceEnvStore.setState({ env: { kind: "local" } });
      useWorkspaceEnvStore.setState({ env: ssh });
      pending.resolve({ diffText: "+old" });
      await operation;
    });
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  },
);
it("refuses a retired semantic helper before any Git or model work", async () => {
  await act(async () => root.render(<Probe />));
  const groups = await generateSemanticStagingGroups({
    repoRoot: "/project",
    files: panel.fileEntries,
    selectedModelId: "gpt-6.1-sol",
    apiKeys: useChatStore.getState().apiKeys,
    preferences: {},
    workspaceEnv: ssh,
    isCurrent: () => false,
  });
  expect(groups).toEqual([]);
  expect(mocks.diff).not.toHaveBeenCalled();
  expect(mocks.model).not.toHaveBeenCalled();
});
it("releases admission when generation preflight refuses missing configuration", async () => {
  useChatStore.setState({ apiKeys: { ...previousChat.apiKeys, openai: "" } });
  await act(async () => root.render(<Probe />));
  await act(async () => start("message"));
  expect(mocks.diff).not.toHaveBeenCalled();
  expect(panel.actionError).toBeTruthy();
  await act(async () =>
    useChatStore.setState({
      apiKeys: { ...previousChat.apiKeys, openai: "test-restored" },
    }),
  );
  await act(async () => start("message"));
  expect(mocks.diff).toHaveBeenCalledTimes(1);
  expect(panel.commitMessage).toBe("fix: generated");
});
