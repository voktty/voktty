// @vitest-environment happy-dom

import { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import { createHarnessProjectReservations } from "@/modules/harness/lib/harnessProjectReservations";
import type { Session } from "@/modules/harness/lib/session";
import { act, createElement, StrictMode, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  cancel: vi.fn(),
  checkpoint: vi.fn(),
  prepareAttachments: vi.fn(),
  steer: vi.fn(),
  compact: vi.fn(),
  canCompact: vi.fn(),
  index: vi.fn(),
  notes: vi.fn(),
  skills: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/harness/lib/harness", async () => {
  const actual = await import("@/modules/harness/lib/harness/apply");
  return {
    ...actual,
    isLiveHarness: () => true,
    canSteerHarness: () => true,
    sendHarnessTurn: mocks.send,
    cancelHarnessTurn: mocks.cancel,
    generateHarnessTitle: vi.fn().mockResolvedValue(undefined),
    forgetHarnessSession: vi.fn().mockResolvedValue(undefined),
    canRewindHarnessLastTurn: () => false,
    canCompactHarnessContext: mocks.canCompact,
    compactHarnessContext: mocks.compact,
    steerHarnessTurn: mocks.steer,
    respondHarnessApproval: vi.fn(),
    respondHarnessQuestion: vi.fn(),
    keepHarnessQuestionOpen: vi.fn(),
  };
});
vi.mock("@/modules/harness/lib/checkpoint", () => ({
  beginSessionTurn: mocks.checkpoint,
  syncSessionCheckpoint: mocks.checkpoint,
  notifyReviewChanged: vi.fn(),
  prepareSessionCheckpoint: mocks.checkpoint,
  captureSessionCheckpoint: mocks.checkpoint,
}));
vi.mock("@/modules/harness/lib/attachments", () => ({
  displayAttachments: (files: unknown) => files,
  prepareAttachments: mocks.prepareAttachments,
}));
vi.mock("@/modules/connections/model/remoteCommands", () => ({
  readCapturedProjectIndex: mocks.index,
}));
vi.mock("@/modules/harness/lib/skills", () => ({
  warmPiSkills: () => {},
  applySkillsToTurn: mocks.skills,
}));
vi.mock("@/modules/harness/lib/notes", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/notes")>()),
  applyNotesToTurn: mocks.notes,
}));
vi.mock("@/modules/harness/lib/providerAccounts", () => ({
  supportsProviderAccounts: () => false,
}));
vi.mock("@/modules/harness/lib/dockBadge", () => ({ syncDockBadge: vi.fn() }));
vi.mock("@/modules/harness/lib/sounds", () => ({ playCue: vi.fn() }));
vi.mock("@/modules/harness/lib/fileWatch", () => ({
  nudgeWatchedFiles: vi.fn(),
}));

vi.mock("@/modules/harness/lib/fileTree", () => ({
  notifyDirsChanged: vi.fn(),
  subscribeDirsChanged: () => () => {},
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  notifyGitChanged: vi.fn(),
  listProjectFiles: async () => [],
}));

function chat(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/repo",
    title: "named",
    blocks: [{ id: `${id}-user`, role: "user", text: "previous" }],
    ...patch,
  };
}
let roots: Root[] = [];
let containers: HTMLElement[] = [];
function mount(
  sessions: Session[],
  projects = createHarnessProjectReservations(),
) {
  let engine!: ReturnType<typeof useHarnessSessionEngine>;
  const container = document.createElement("div");
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  function Harness() {
    const reservationRevision = useSyncExternalStore(
      projects.subscribe,
      projects.getSnapshot,
    );
    engine = useHarnessSessionEngine({
      initialSessions: () => sessions,
      isForeground: () => true,
      isRemoving: () => false,
      isSwitching: () => false,
      isProjectReserved: projects.has,
      reservationRevision,
    });
    return null;
  }
  act(() =>
    root.render(createElement(StrictMode, null, createElement(Harness))),
  );
  return () => engine;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.send.mockReset().mockResolvedValue(undefined);
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.checkpoint.mockReset().mockResolvedValue(undefined);
  mocks.prepareAttachments
    .mockReset()
    .mockImplementation(async (files) => files);
  mocks.steer.mockReset().mockResolvedValue(undefined);
  mocks.compact.mockReset().mockResolvedValue(undefined);
  mocks.canCompact.mockReset().mockReturnValue(false);
});
afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots = [];
  for (const container of containers) container.remove();
  containers = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const cwd = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const { usePreferencesStore } = await import("@/modules/settings/preferences");
const { rememberRemoteProject } = await import(
  "@/modules/connections/model/remoteProjects"
);
const { invalidateProjectFiles } = await import(
  "@/modules/harness/lib/fileIndex"
);

beforeEach(() => {
  invalidateProjectFiles();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  mocks.index
    .mockReset()
    .mockResolvedValue([
      { name: "file.ts", relative: "src/file.ts", path: `${cwd}/src/file.ts` },
    ]);
  mocks.notes.mockReset().mockImplementation(async (text: string) => text);
  mocks.skills.mockReset().mockImplementation(async (text: string) => text);
});
afterEach(() => {
  invalidateProjectFiles();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it.each(["send", "steer"] as const)(
  "does not %s through a profile replaced while attachments were preparing",
  async (mode) => {
    let finish!: (value: []) => void;
    mocks.prepareAttachments.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    const engine = mount([chat("source", { cwd, busy: mode === "steer" })]);
    await act(async () =>
      engine().onSubmit("source", "look at @file.ts", [], {
        followUpBehavior: "steer",
      }),
    );
    expect(mocks.prepareAttachments).toHaveBeenCalledOnce();
    await act(async () => {
      usePreferencesStore.setState({
        sshConnections: [{ ...profile, host: "replacement.invalid" }],
      });
      finish([]);
      await vi.dynamicImportSettled();
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.steer).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  },
);

it("does not turn a retired file-index read into an unannotated provider request", async () => {
  let finish!: (value: unknown) => void;
  mocks.index.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const engine = mount([chat("source", { cwd })]);
  await act(async () => {
    engine().onSubmit("source", "look at @file.ts");
    await vi.dynamicImportSettled();
  });
  expect(mocks.index).toHaveBeenCalledOnce();
  await act(async () => {
    usePreferencesStore.setState({ sshConnections: [] });
    finish([]);
  });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.notes).not.toHaveBeenCalled();
});

it.each(["notes", "skills"] as const)(
  "does not send after the source changes during %s",
  async (phase) => {
    let finish!: (value: string) => void;
    mocks[phase].mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const engine = mount([chat("source", { cwd })]);
    await act(async () => {
      engine().onSubmit("source", "hello");
      await vi.dynamicImportSettled();
    });
    expect(mocks[phase]).toHaveBeenCalledOnce();
    await act(async () => {
      usePreferencesStore.setState({ sshConnections: [] });
      finish("prepared");
    });
    expect(mocks.send).not.toHaveBeenCalled();
    if (phase === "notes") expect(mocks.skills).not.toHaveBeenCalled();
  },
);

it("keeps a profile roundtrip retired before indexing", async () => {
  let finish!: (value: []) => void;
  mocks.prepareAttachments.mockImplementationOnce(
    () =>
      new Promise<[]>((resolve) => {
        finish = resolve;
      }),
  );
  const engine = mount([chat("source", { cwd })]);
  await act(async () => engine().onSubmit("source", "@file.ts"));
  await act(async () => {
    usePreferencesStore.setState({ sshConnections: [] });
    usePreferencesStore.setState({ sshConnections: [profile] });
    finish([]);
  });
  expect(mocks.index).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each(["send", "steer"] as const)(
  "allows %s with the current original source",
  async (mode) => {
    const engine = mount([chat("source", { cwd, busy: mode === "steer" })]);
    await act(async () => {
      engine().onSubmit("source", "@file.ts", [], {
        followUpBehavior: "steer",
      });
      await vi.dynamicImportSettled();
    });
    expect(mocks[mode]).toHaveBeenCalledOnce();
    expect(mocks[mode].mock.calls[0][0].text).toContain("src/file.ts");
    expect(mocks.index).toHaveBeenCalledOnce();
    expect(mocks.index.mock.calls[0][2].host).toBe(profile.host);
  },
);
