// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BlameDialog } from "@/modules/source-control/BlameDialog";
import type { GitBlameLine } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ blame: vi.fn(), env: { kind: "local" } }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitBlame: mocks.blame },
}));
vi.mock("@/modules/workspace", () => ({
  useWorkspaceEnvStore: (select: (value: unknown) => unknown) =>
    select({ env: mocks.env }),
}));
let root: Root;
let node: HTMLDivElement;
const local: WorkspaceEnv = { kind: "local" };
const committed = vi.fn();
const line = (content: string): GitBlameLine => ({
  lineNumber: 1,
  sha: "abcdef123",
  author: "Author",
  authorTimeSecs: 1,
  summary: "Change",
  content,
});
function Probe({
  workspace = local,
  path = "/repo/a.ts",
  open = true,
}: {
  workspace?: WorkspaceEnv;
  path?: string;
  open?: boolean;
}) {
  useLayoutEffect(() => {
    committed(document.body.textContent);
  });
  return (
    <BlameDialog
      open={open}
      onOpenChange={() => {}}
      repoRoot="/repo"
      path={path}
      workspace={workspace}
    />
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.blame.mockReset().mockResolvedValue([line("original content")]);
  committed.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
it("loads the explicitly supplied filesystem instead of the global workspace", async () => {
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  await act(async () => root.render(<Probe workspace={workspace} />));
  expect(mocks.blame).toHaveBeenCalledExactlyOnceWith(
    "/repo",
    "/repo/a.ts",
    workspace,
  );
  expect(document.body.textContent).toContain("original content");
});
it("never commits the previous file's content beneath a new file heading", async () => {
  await act(async () => root.render(<Probe />));
  mocks.blame.mockReturnValue(new Promise(() => {}));
  committed.mockClear();
  await act(async () => root.render(<Probe path="/repo/b.ts" />));
  expect(committed).toHaveBeenCalled();
  for (const [text] of committed.mock.calls)
    expect(text).not.toContain("original content");
});
it("does not reload for an equivalent explicit filesystem object", async () => {
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  await act(async () => root.render(<Probe workspace={{ kind: "local" }} />));
  expect(mocks.blame).toHaveBeenCalledTimes(1);
});
it("discards late replies after the file changes", async () => {
  let done!: (lines: GitBlameLine[]) => void;
  mocks.blame.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  await act(async () => root.render(<Probe />));
  mocks.blame.mockResolvedValue([line("current content")]);
  await act(async () => root.render(<Probe path="/repo/b.ts" />));
  await act(async () => done([line("stale content")]));
  expect(document.body.textContent).toContain("current content");
  expect(document.body.textContent).not.toContain("stale content");
});
it("does not read while closed", async () => {
  await act(async () => root.render(<Probe open={false} />));
  expect(mocks.blame).not.toHaveBeenCalled();
});

it("bounds retired reads and never displays their late content", async () => {
  const completions: ((lines: GitBlameLine[]) => void)[] = [];
  mocks.blame.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  for (let index = 0; index <= 256; index++) {
    await act(async () => root.render(<Probe path={`/repo/${index}.ts`} />));
  }
  expect(mocks.blame).toHaveBeenCalledTimes(256);
  await act(async () => {
    for (const done of completions) done([line("retired content")]);
  });
  expect(document.body.textContent).not.toContain("retired content");
  mocks.blame.mockResolvedValue([line("retry content")]);
  await act(async () => root.render(<Probe path="/repo/retry.ts" />));
  expect(mocks.blame).toHaveBeenCalledTimes(257);
  expect(document.body.textContent).toContain("retry content");
});

it("refuses namespace paths without sending them to local Git", async () => {
  await act(async () =>
    root.render(<Probe path="remote://voktty-ssh-build/repo/a.ts" />),
  );
  expect(mocks.blame).not.toHaveBeenCalled();
});
