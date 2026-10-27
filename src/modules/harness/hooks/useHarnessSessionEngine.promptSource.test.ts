// @vitest-environment happy-dom

import { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import { createHarnessProjectReservations } from "@/modules/harness/lib/harnessProjectReservations";
import { collectWindowTransfer } from "@/modules/harness/lib/windowTransfer";
import { newTab } from "@/modules/harness/lib/layout";
import { sanitizeSessionForPersist } from "@/modules/harness/lib/sessionStore";
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

it.each(["replacement", "roundtrip"] as const)(
  "does not steer a queued message after a profile %s",
  async (change) => {
    const engine = mount([chat("source", { cwd, busy: true })]);
    await act(async () => {
      engine().onSubmit("source", "@file.ts", [], {
        followUpBehavior: "queue",
      });
    });
    const message = engine().sessions[0].queuedMessages?.[0];
    if (!message) throw new Error("Expected queued message");
    await act(async () => {
      usePreferencesStore.setState({
        sshConnections: [{ ...profile, host: "replacement.invalid" }],
      });
      if (change === "roundtrip")
        usePreferencesStore.setState({ sshConnections: [profile] });
      engine().onSteerQueuedMessage("source", message.id);
      await vi.dynamicImportSettled();
    });
    expect(mocks.steer).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
    expect(engine().sessions[0].queuedMessages?.[0]).toEqual(message);
    expect(engine().sessions[0].queueStatus).toBe("paused");
    expect(engine().sessions[0].busy).toBe(true);
  },
);

it("pauses automatic dispatch without removing the retired queued head", async () => {
  vi.useFakeTimers();
  const engine = mount([chat("source", { cwd, busy: true })]);
  await act(async () => {
    engine().onSubmit("source", "@file.ts", [], { followUpBehavior: "queue" });
    usePreferencesStore.setState({ sshConnections: [] });
    engine().updateSession("source", (session) => ({
      ...session,
      busy: false,
    }));
  });
  await act(async () => vi.advanceTimersByTime(0));
  expect(engine().sessions[0].queueStatus).toBe("paused");
  expect(engine().sessions[0].queuedMessages?.[0].text).toBe("@file.ts");
  expect(mocks.prepareAttachments).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each(["dispatch", "steer"] as const)(
  "preserves a current queued source through %s and later preparation",
  async (mode) => {
    let finish!: (value: []) => void;
    mocks.prepareAttachments.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    const engine = mount([chat("source", { cwd, busy: true })]);
    await act(async () =>
      engine().onSubmit("source", "@file.ts", [], {
        followUpBehavior: "queue",
      }),
    );
    const message = engine().sessions[0].queuedMessages?.[0];
    if (!message) throw new Error("Expected queued message");
    await act(async () => {
      if (mode === "dispatch") {
        engine().updateSession(
          "source",
          (session) => ({ ...session, busy: false }),
          "immediate",
        );
        engine().onSubmit("source", message.text, message.attachments, {
          queuedMessageId: message.id,
        });
      } else engine().onSteerQueuedMessage("source", message.id);
    });
    expect(mocks.prepareAttachments).toHaveBeenCalledOnce();
    expect(engine().sessions[0].queuedMessages).toBeUndefined();
    await act(async () => {
      usePreferencesStore.setState({ sshConnections: [] });
      usePreferencesStore.setState({ sshConnections: [profile] });
      finish([]);
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.steer).not.toHaveBeenCalled();
  },
);

it("sends an edited queued message through its original healthy source", async () => {
  const engine = mount([chat("source", { cwd, busy: true })]);
  await act(async () =>
    engine().onSubmit("source", "before", [], { followUpBehavior: "queue" }),
  );
  const message = engine().sessions[0].queuedMessages?.[0];
  if (!message) throw new Error("Expected queued message");
  await act(async () =>
    engine().onEditQueuedMessage("source", message.id, "@file.ts"),
  );
  await act(async () => {
    engine().onSteerQueuedMessage("source", message.id);
    await vi.dynamicImportSettled();
  });
  expect(mocks.steer).toHaveBeenCalledOnce();
  expect(mocks.steer.mock.calls[0][0].text).toContain("src/file.ts");
  expect(mocks.index.mock.calls[0][2].host).toBe(profile.host);
});

it("does not grant unknown remote queued provenance after session replacement", async () => {
  const engine = mount([chat("source", { cwd, busy: true })]);
  await act(async () =>
    engine().onSubmit("source", "@file.ts", [], { followUpBehavior: "queue" }),
  );
  const original = engine().sessions[0];
  const message = original.queuedMessages?.[0];
  if (!message) throw new Error("Expected queued message");
  await act(async () => {
    engine().removeSession("source", "immediate");
    engine().admitSession({ ...original }, "immediate");
  });
  await act(async () => engine().onSteerQueuedMessage("source", message.id));
  expect(mocks.steer).not.toHaveBeenCalled();
  expect(engine().sessions[0].queueStatus).toBe("paused");
});

it("rejects a cached queue submission after the engine unmounts", async () => {
  const engine = mount([chat("source", { cwd, busy: true })]);
  const original = engine();
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  original.onSubmit("source", "late", [], { followUpBehavior: "queue" });
  expect(original.sessionsRef.current[0].queuedMessages).toBeUndefined();
  expect(mocks.steer).not.toHaveBeenCalled();
});

it("claims a queued steering request only once before React commits its removal", async () => {
  let finish!: (value: []) => void;
  mocks.prepareAttachments.mockImplementationOnce(
    () =>
      new Promise<[]>((resolve) => {
        finish = resolve;
      }),
  );
  const engine = mount([chat("source", { cwd, busy: true })]);
  await act(async () =>
    engine().onSubmit("source", "hello", [], { followUpBehavior: "queue" }),
  );
  const message = engine().sessions[0].queuedMessages?.[0];
  if (!message) throw new Error("Expected queued message");
  await act(async () => {
    engine().onSteerQueuedMessage("source", message.id);
    engine().onSteerQueuedMessage("source", message.id);
  });
  expect(mocks.prepareAttachments).toHaveBeenCalledOnce();
  await act(async () => {
    finish([]);
    await vi.dynamicImportSettled();
  });
  expect(mocks.steer).toHaveBeenCalledOnce();
  expect(engine().sessions[0].queuedMessages).toBeUndefined();
});

it.each(["/project", "C:/project", "//server/share/project"])(
  "keeps the original queued worktree after a branch reset and window transfer at %s",
  async (project) => {
    const source = mount([
      chat("source", {
        cwd: project,
        worktreeCwd: `${project}/worktree`,
        busy: true,
      }),
    ]);
    await act(async () =>
      source().onSubmit("source", "original request", [], {
        followUpBehavior: "queue",
      }),
    );
    await act(async () =>
      source().updateSession(
        "source",
        (session) => ({
          ...session,
          busy: false,
          queueStatus: "paused",
          worktreeCwd: undefined,
          branch: undefined,
          providerSessionId: undefined,
        }),
        "immediate",
      ),
    );
    const tab = newTab("source");
    const payload = collectWindowTransfer(
      [tab],
      source().sessions,
      [tab.id],
      tab.id,
      new Set(),
      project,
    );
    if (!payload) throw new Error("Missing transfer payload");
    const wire = JSON.parse(JSON.stringify(payload)) as typeof payload;
    const destination = mount(wire.sessions);
    const message = destination().sessions[0].queuedMessages?.[0];
    if (!message) throw new Error("Missing transferred queued message");
    await act(async () => {
      destination().onSteerQueuedMessage("source", message.id);
      await vi.dynamicImportSettled();
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.steer).not.toHaveBeenCalled();
    expect(mocks.prepareAttachments).not.toHaveBeenCalled();
    expect(destination().sessions[0].queueStatus).toBe("paused");
    expect(destination().sessions[0].queuedMessages?.[0].text).toBe(
      "original request",
    );
  },
);

function transferredSessions(sessions: Session[]): Session[] {
  const tab = newTab(sessions[0].id);
  const payload = collectWindowTransfer(
    [tab],
    sessions,
    [tab.id],
    tab.id,
    new Set(),
    sessions[0].cwd,
  );
  if (!payload) throw new Error("Missing transfer payload");
  return JSON.parse(JSON.stringify(payload)).sessions;
}

it.each(["/project", "C:/project", "//server/share/project"])(
  "sends a healthy transferred native queue through its original worktree at %s",
  async (project) => {
    const worktree = `${project}/worktree`;
    const source = mount([
      chat("source", { cwd: project, worktreeCwd: worktree, busy: true }),
    ]);
    await act(async () =>
      source().onSubmit("source", "original", [], {
        followUpBehavior: "queue",
      }),
    );
    await act(async () =>
      source().updateSession(
        "source",
        (session) => ({ ...session, busy: false, queueStatus: "paused" }),
        "immediate",
      ),
    );
    const destination = mount(transferredSessions(source().sessions));
    const message = destination().sessions[0].queuedMessages?.[0];
    if (!message) throw new Error("Missing queued message");
    expect(message.sourceCwd).toBe(worktree);
    await act(async () => {
      destination().onSteerQueuedMessage("source", message.id);
      await vi.dynamicImportSettled();
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0].cwd).toBe(worktree);
    expect(destination().sessions[0].queuedMessages).toBeUndefined();
  },
);

it("does not rebind transferred queue origin when its text is edited", async () => {
  const source = mount([
    chat("source", {
      cwd: "/project",
      worktreeCwd: "/project/old",
      busy: true,
    }),
  ]);
  await act(async () =>
    source().onSubmit("source", "original", [], { followUpBehavior: "queue" }),
  );
  const destination = mount(
    transferredSessions([
      {
        ...source().sessions[0],
        busy: false,
        queueStatus: "paused",
        worktreeCwd: undefined,
      },
    ]),
  );
  const message = destination().sessions[0].queuedMessages?.[0];
  if (!message) throw new Error("Missing queued message");
  await act(async () =>
    destination().onEditQueuedMessage("source", message.id, "edited"),
  );
  await act(async () =>
    destination().onSteerQueuedMessage("source", message.id),
  );
  expect(mocks.send).not.toHaveBeenCalled();
  expect(destination().sessions[0].queuedMessages?.[0]).toMatchObject({
    text: "edited",
    sourceCwd: "/project/old",
  });
});

it("pauses automatic dispatch of a transferred queue whose directory changed", async () => {
  vi.useFakeTimers();
  const source = mount([
    chat("source", {
      cwd: "/project",
      worktreeCwd: "/project/old",
      busy: true,
    }),
  ]);
  await act(async () =>
    source().onSubmit("source", "original", [], { followUpBehavior: "queue" }),
  );
  const destination = mount(
    transferredSessions([
      { ...source().sessions[0], busy: false, worktreeCwd: undefined },
    ]),
  );
  await act(async () => vi.advanceTimersByTime(0));
  expect(mocks.prepareAttachments).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(destination().sessions[0].queueStatus).toBe("paused");
  expect(destination().sessions[0].queuedMessages?.[0].sourceCwd).toBe(
    "/project/old",
  );
});

it("retains native compatibility for transferred queues predating origin tags", async () => {
  const destination = mount(
    transferredSessions([
      chat("source", {
        cwd: "/project",
        busy: false,
        queueStatus: "paused",
        queuedMessages: [{ id: "legacy", text: "original", attachments: [] }],
      }),
    ]),
  );
  await act(async () => {
    destination().onSteerQueuedMessage("source", "legacy");
    await vi.dynamicImportSettled();
  });
  expect(mocks.send).toHaveBeenCalledOnce();
});

it("does not reconstruct a saved SSH receipt from a transferred directory tag", async () => {
  const source = mount([chat("source", { cwd, busy: true })]);
  await act(async () =>
    source().onSubmit("source", "original", [], { followUpBehavior: "queue" }),
  );
  const destination = mount(
    transferredSessions([
      { ...source().sessions[0], busy: false, queueStatus: "paused" },
    ]),
  );
  const message = destination().sessions[0].queuedMessages?.[0];
  if (!message) throw new Error("Missing queued message");
  await act(async () =>
    destination().onSteerQueuedMessage("source", message.id),
  );
  expect(mocks.prepareAttachments).not.toHaveBeenCalled();
  expect(mocks.index).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(destination().sessions[0].queueStatus).toBe("paused");
});

it("keeps queued requests and their origin tags out of normal session persistence", async () => {
  const source = mount([chat("source", { cwd: "/project", busy: true })]);
  await act(async () =>
    source().onSubmit("source", "queued private fixture", [], {
      followUpBehavior: "queue",
    }),
  );
  expect(source().sessions[0].queuedMessages?.[0].sourceCwd).toBe("/project");
  const saved = JSON.stringify(sanitizeSessionForPersist(source().sessions[0]));
  expect(saved).not.toContain("queuedMessages");
  expect(saved).not.toContain("sourceCwd");
  expect(saved).not.toContain("queued private fixture");
});

it("claims a transferred native steering request once before React commits", async () => {
  const source = mount([chat("source", { cwd: "/project", busy: true })]);
  await act(async () =>
    source().onSubmit("source", "original", [], { followUpBehavior: "queue" }),
  );
  const destination = mount(transferredSessions(source().sessions));
  const message = destination().sessions[0].queuedMessages?.[0];
  if (!message) throw new Error("Missing queued message");
  let finish!: (value: []) => void;
  mocks.prepareAttachments.mockImplementationOnce(
    () =>
      new Promise<[]>((done) => {
        finish = done;
      }),
  );
  await act(async () => {
    destination().onSteerQueuedMessage("source", message.id);
    destination().onSteerQueuedMessage("source", message.id);
  });
  const admissions = mocks.prepareAttachments.mock.calls.length;
  await act(async () => {
    finish([]);
    await vi.dynamicImportSettled();
  });
  expect(admissions).toBe(1);
  expect(mocks.steer).toHaveBeenCalledOnce();
});
