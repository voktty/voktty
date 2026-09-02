import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHarnessStore } from "./harnessStore";

vi.mock("../harnessClient", () => ({
  harnessClient: {
    spawn: vi.fn().mockResolvedValue(1234),
    stdin: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(true),
    probeAvailability: vi.fn().mockResolvedValue([
      { harness: "antigravity", binary: "agy", installed: true },
    ]),
    initCheckpoint: vi.fn().mockResolvedValue(undefined),
    getCheckpointStatus: vi.fn().mockResolvedValue({
      sessionId: "s1",
      cwd: "/test",
      files: [{ relative: "src/index.ts", status: "modified", additions: 5, deletions: 2 }],
      totalAdditions: 5,
      totalDeletions: 2,
    }),
    undoCheckpoint: vi.fn().mockResolvedValue(1),
    keepCheckpoint: vi.fn().mockResolvedValue(undefined),
    upsertSession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn().mockResolvedValue(true),
    onStdout: vi.fn().mockResolvedValue(() => {}),
    onStderr: vi.fn().mockResolvedValue(() => {}),
    onExit: vi.fn().mockResolvedValue(() => {}),
  },
}));

describe("useHarnessStore", () => {
  beforeEach(() => {
    useHarnessStore.setState({
      sessions: {},
      sessionSummaries: [],
      activeSessionId: null,
      isStreaming: {},
      checkpoints: {},
      availableAgents: [],
      statusText: {},
    });
  });

  it("creates a new session", async () => {
    const id = await useHarnessStore.getState().createSession({
      cwd: "/test/voktty",
      harness: "antigravity",
      model: "gemini-3.7-flash",
      title: "Test Task",
    });

    expect(id).toBeDefined();
    const session = useHarnessStore.getState().sessions[id];
    expect(session).toBeDefined();
    expect(session?.cwd).toBe("/test/voktty");
    expect(session?.harness).toBe("antigravity");
    expect(useHarnessStore.getState().activeSessionId).toBe(id);
  });

  it("probes available agents", async () => {
    await useHarnessStore.getState().probeAgents();
    const agents = useHarnessStore.getState().availableAgents;
    expect(agents.length).toBe(1);
    expect(agents[0].harness).toBe("antigravity");
  });

  it("refreshes and undos checkpoints", async () => {
    await useHarnessStore.getState().refreshCheckpoint("s1", "/test");
    const cp = useHarnessStore.getState().checkpoints["s1"];
    expect(cp).toBeDefined();
    expect(cp?.files.length).toBe(1);

    const reverted = await useHarnessStore.getState().undoTurn("s1", "/test");
    expect(reverted).toBe(1);
    expect(useHarnessStore.getState().checkpoints["s1"]).toBeNull();
  });
});
