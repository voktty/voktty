import { beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({
  inspect: vi.fn(),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
  removeFile: vi.fn(),
  removeEmptyDirectory: vi.fn(),
}));
vi.mock("@/modules/ai/lib/nativeOperationAdapter", () => ({
  nativeOperationAdapter: io,
}));
import { usePlanStore, type QueuedEdit } from "@/modules/ai/store/planStore";

function entry(id: string): QueuedEdit {
  return {
    id,
    kind: "edit",
    path: `/repo/${id}.ts`,
    originalContent: "before",
    proposedContent: "after",
    isNewFile: false,
    workspaceEnv: { kind: "local" },
    sessionId: "fixture",
    modelId: "fixture",
    createdAt: 1,
  };
}
function gate() {
  let resolve!: (value: { kind: "file"; content: string }) => void;
  const promise = new Promise<{ kind: "file"; content: string }>((done) => {
    resolve = done;
  });
  io.inspect.mockReturnValueOnce(promise);
  return resolve;
}
beforeEach(() => {
  vi.resetAllMocks();
  io.inspect.mockResolvedValue({ kind: "file", content: "before" });
  io.writeFile.mockResolvedValue(undefined);
  usePlanStore.setState({
    active: true,
    queue: [],
    pendingCommands: [],
    lastOperation: null,
    lastError: null,
  });
  usePlanStore.getState().enqueue(entry("first"));
});

it("refuses another apply before the first preflight settles", async () => {
  const release = gate();
  const first = usePlanStore.getState().applyAll();
  const second = usePlanStore.getState().applyAll();
  release({ kind: "file", content: "before" });
  const results = await Promise.all([first, second]);
  expect(results.map((result) => result.ok)).toEqual([true, false]);
  expect(io.inspect).toHaveBeenCalledOnce();
  expect(io.writeFile).toHaveBeenCalledOnce();
});

it("preserves edits enqueued while another batch is applying", async () => {
  const release = gate();
  const applying = usePlanStore.getState().applyAll();
  expect(usePlanStore.getState().enqueue(entry("second")).ok).toBe(true);
  release({ kind: "file", content: "before" });
  expect((await applying).ok).toBe(true);
  expect(usePlanStore.getState().queue.map((item) => item.id)).toEqual([
    "second",
  ]);
});

it("keeps admitted entries retryable when rejection controls run during failed preflight", async () => {
  const release = gate();
  const applying = usePlanStore.getState().applyAll();
  usePlanStore.getState().removeOne("first");
  usePlanStore.getState().clear();
  usePlanStore.getState().disable();
  release({ kind: "file", content: "changed" });
  expect((await applying).ok).toBe(false);
  expect(usePlanStore.getState().queue.map((item) => item.id)).toEqual([
    "first",
  ]);
  expect(io.writeFile).not.toHaveBeenCalled();
});

it("keeps commands recorded after admission in the pending queue", async () => {
  const release = gate();
  const applying = usePlanStore.getState().applyAll();
  usePlanStore.getState().recordCommand({
    kind: "tests",
    command: "pnpm test",
    exitCode: 0,
    cancelled: false,
    timedOut: false,
    ranAt: 2,
  });
  release({ kind: "file", content: "before" });
  expect((await applying).ok).toBe(true);
  expect(usePlanStore.getState().pendingCommands).toHaveLength(1);
  expect(usePlanStore.getState().lastOperation?.commands).toHaveLength(0);
});

it("refuses duplicate undo and preserves provenance published during undo", async () => {
  expect((await usePlanStore.getState().applyAll()).ok).toBe(true);
  io.inspect.mockClear();
  io.writeFile.mockClear();
  const release = gate();
  const first = usePlanStore.getState().revertLast();
  const second = usePlanStore.getState().revertLast();
  usePlanStore.getState().recordCommand({
    kind: "tests",
    command: "pnpm test",
    exitCode: 0,
    cancelled: false,
    timedOut: false,
    ranAt: 2,
  });
  release({ kind: "file", content: "after" });
  const results = await Promise.all([first, second]);
  expect(results.map((result) => result.ok)).toEqual([true, false]);
  expect(io.writeFile).toHaveBeenCalledOnce();
  expect(usePlanStore.getState().lastOperation?.commands).toHaveLength(1);
});
