// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceControlPanel } from "@/modules/source-control/SourceControlPanel";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";
import { t } from "@/modules/i18n";

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const refreshCallbacks = vi.hoisted(() => [] as (() => void)[]);
vi.mock("sonner", () => ({ toast: feedback }));
vi.mock("@/modules/ai/lib/native", () => ({ native: {} }));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  useAiAvailable: () => false,
  isAiRuntimeAvailable: () => false,
}));
vi.mock("@/modules/source-control/ConflictsPanel", () => ({
  ConflictsPanel: ({ onRefresh }: { onRefresh: () => void }) => {
    refreshCallbacks.push(onRefresh);
    return null;
  },
}));
vi.mock("@/modules/source-control/BranchCompareDialog", () => ({
  BranchCompareDialog: () => null,
}));
vi.mock("@/modules/source-control/GitStashAndTags", () => ({
  StashDropdown: () => null,
  TagDropdown: () => null,
}));
vi.mock("@/modules/source-control/GitCloneModal", () => ({
  GitCloneModal: () => null,
}));
let root: Root;
let container: HTMLDivElement;
let value: SourceControlSummary;
type Control = "trust" | "init";
function render(open = true) {
  return act(async () =>
    root.render(
      <SourceControlPanel
        open={open}
        sourceControl={value}
        onOpenDiff={() => {}}
        repositoryTarget={{ mode: "follow-context" }}
        onFollowRepositoryContext={() => {}}
      />,
    ),
  );
}
function click(control: Control) {
  const label = t(
    control === "trust" ? "git.authorizeDirectory" : "git.initializeRepo",
  );
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing control: ${control}`);
  button.click();
}
function install(control: Control, run: () => Promise<boolean>) {
  if (control === "trust") value.trustRepository = vi.fn(run);
  else value.initRepository = vi.fn(run);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  feedback.success.mockReset();
  feedback.error.mockReset();
  refreshCallbacks.length = 0;
  container = document.createElement("div");
  root = createRoot(container);
  value = {
    contextPath: "/project",
    repo: null,
    status: null,
    changedCount: 0,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasRepo: false,
    isLoading: false,
    localError: null,
    dubiousOwnershipPath: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: vi.fn(),
    refresh: vi.fn(async () => {}),
    trustRepository: vi.fn(async () => true),
    initRepository: vi.fn(async () => true),
    undoCommit: vi.fn(async () => true),
    runRemoteAction: vi.fn(async () => ({ ok: false, action: null })),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each<Control>(["trust", "init"])(
  "does not announce an unacknowledged %s",
  async (control) => {
    install(control, async () => false);
    await render();
    await act(async () => click(control));
    expect(feedback.success).not.toHaveBeenCalled();
    expect(feedback.error).not.toHaveBeenCalled();
  },
);

function clickRefresh() {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${t("git.refreshSourceControl")}"]`,
  );
  expect(button).not.toBeNull();
  button?.click();
}
function refreshAnimating() {
  return !!container.querySelector(
    `button[aria-label="${t("git.refreshSourceControl")}"] .animate-spin`,
  );
}
it("keeps a newer refresh animating while an older refresh settles", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let first!: () => void;
  let second!: () => void;
  value.refresh = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          first = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          second = resolve;
        }),
    );
  await render();
  await act(async () => clickRefresh());
  await act(async () => clickRefresh());
  await act(async () => first());
  await act(async () => vi.advanceTimersByTime(450));
  expect(refreshAnimating()).toBe(true);
  await act(async () => second());
  await act(async () => vi.advanceTimersByTime(450));
  expect(refreshAnimating()).toBe(false);
});
it("does not lend refresh animation or a cached refresh callback to another context", async () => {
  let done!: () => void;
  value.refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await render();
  const retired = refreshCallbacks[refreshCallbacks.length - 1];
  await act(async () => clickRefresh());
  expect(refreshAnimating()).toBe(true);
  value = { ...value, contextPath: "/replacement" };
  await render();
  expect(refreshAnimating()).toBe(false);
  expect(retired).toBeDefined();
  await act(async () => retired?.());
  expect(refreshAnimating()).toBe(false);
  await act(async () => done());
});
it("does not allocate a refresh timer after its panel unmounts", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let done!: () => void;
  value.refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await render();
  await act(async () => clickRefresh());
  await act(async () => root.render(null));
  const before = vi.getTimerCount();
  await act(async () => done());
  expect(vi.getTimerCount()).toBe(before);
});
it("finishes current refresh feedback after rejection without an unhandled promise", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  value.refresh = vi.fn(async () => {
    throw new Error("Refresh refused");
  });
  await render();
  await act(async () => clickRefresh());
  expect(refreshAnimating()).toBe(true);
  await act(async () => vi.advanceTimersByTime(449));
  expect(refreshAnimating()).toBe(true);
  await act(async () => vi.advanceTimersByTime(1));
  expect(refreshAnimating()).toBe(false);
  expect(feedback.error).not.toHaveBeenCalled();
});
it("does not revive refresh feedback after closing and reopening the same panel", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let done!: () => void;
  value.refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await render();
  await act(async () => clickRefresh());
  await render(false);
  await render();
  const before = vi.getTimerCount();
  await act(async () => done());
  expect(refreshAnimating()).toBe(false);
  expect(vi.getTimerCount()).toBe(before);
});
it.each<Control>(["trust", "init"])(
  "announces current %s success exactly once",
  async (control) => {
    await render();
    await act(async () => click(control));
    expect(feedback.success).toHaveBeenCalledTimes(1);
  },
);
it.each<Control>(["trust", "init"])(
  "suppresses %s success after its panel closes",
  async (control) => {
    let done!: (accepted: boolean) => void;
    install(
      control,
      () =>
        new Promise<boolean>((resolve) => {
          done = resolve;
        }),
    );
    await render();
    await act(async () => click(control));
    await render(false);
    await act(async () => done(true));
    expect(feedback.success).not.toHaveBeenCalled();
    expect(feedback.error).not.toHaveBeenCalled();
  },
);
it.each<Control>(["trust", "init"])(
  "suppresses a retired %s error",
  async (control) => {
    let fail!: (error: Error) => void;
    install(
      control,
      () =>
        new Promise<boolean>((_resolve, reject) => {
          fail = reject;
        }),
    );
    await render();
    await act(async () => click(control));
    await render(false);
    await act(async () => fail(new Error("Retired control failed")));
    expect(feedback.success).not.toHaveBeenCalled();
    expect(feedback.error).not.toHaveBeenCalled();
  },
);
it.each<Control>(["trust", "init"])(
  "reports the current %s failure",
  async (control) => {
    install(control, async () => {
      throw new Error("Control refused");
    });
    await render();
    await act(async () => click(control));
    expect(feedback.error).toHaveBeenCalledTimes(1);
    expect(feedback.success).not.toHaveBeenCalled();
  },
);
it.each<Control>(["trust", "init"])(
  "keeps %s acknowledgement through its own repository discovery",
  async (control) => {
    let done!: (accepted: boolean) => void;
    install(
      control,
      () =>
        new Promise<boolean>((resolve) => {
          done = resolve;
        }),
    );
    await render();
    await act(async () => click(control));
    value = {
      ...value,
      hasRepo: true,
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
        isDetached: false,
        truncated: false,
        changedFiles: [],
      },
    };
    await render();
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    await act(async () => done(true));
    expect(feedback.success).toHaveBeenCalledTimes(1);
    expect(feedback.error).not.toHaveBeenCalled();
  },
);
