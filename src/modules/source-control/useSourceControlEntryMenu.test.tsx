// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSourceControlEntryMenu } from "@/modules/source-control/useSourceControlEntryMenu";
import { useWorkspaceEnvStore } from "@/modules/workspace";

const helpers = vi.hoisted(() => ({ copy: vi.fn(), reveal: vi.fn() }));
vi.mock("@/modules/explorer/lib/contextActions", () => ({
  copyToClipboard: helpers.copy,
  revealInFinder: helpers.reveal,
}));
type Input = Parameters<typeof useSourceControlEntryMenu>[0];
let input: Input;
let api: ReturnType<typeof useSourceControlEntryMenu>;
let root: Root;
let container: HTMLDivElement;
function Probe() {
  api = useSourceControlEntryMenu(input);
  return null;
}
async function render(strict = false) {
  await act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <Probe />
        </StrictMode>
      ) : (
        <Probe />
      ),
    ),
  );
}
async function open() {
  await act(async () => api.setOpen(true));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  helpers.copy.mockReset().mockResolvedValue(undefined);
  helpers.reveal.mockReset().mockResolvedValue(undefined);
  input = {
    entry: {
      key: "file.ts",
      path: "file.ts",
      originalPath: null,
      statusCode: "M",
      statusLabel: "Modified",
      checkState: "unchecked",
      staged: false,
      unstaged: true,
      untracked: false,
    },
    repoRoot: "/project",
    contextKey: "follow",
    actionBusy: null,
    onFocusRow: vi.fn(),
    onSelectFile: vi.fn(async () => {}),
    onToggleStageFile: vi.fn(async () => {}),
    onDiscardFile: vi.fn(),
    onOpenFile: vi.fn(),
  };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("rechecks its originating owner between row focus and diff opening", async () => {
  input.onFocusRow = vi.fn(() =>
    useWorkspaceEnvStore.setState({
      env: { kind: "wsl", distro: "replacement" },
    }),
  );
  await render();
  await open();
  await act(async () => api.diff());
  expect(input.onFocusRow).toHaveBeenCalledExactlyOnceWith("file.ts");
  expect(input.onSelectFile).not.toHaveBeenCalled();
});
it("retains copied row metadata through a reentrant focus callback", async () => {
  const original = { ...input.entry };
  input.onFocusRow = vi.fn(() => {
    input.entry.path = "replacement.ts";
  });
  await render();
  await open();
  await act(async () => api.diff());
  expect(input.onSelectFile).toHaveBeenCalledExactlyOnceWith(original);
});
it("retires file callbacks after the opener is replaced", async () => {
  await render();
  await open();
  const retired = api;
  const oldOpen = input.onOpenFile;
  const nextOpen = vi.fn();
  input = { ...input, onOpenFile: nextOpen };
  await render();
  await act(async () => retired.openFile());
  expect(oldOpen).not.toHaveBeenCalled();
  expect(nextOpen).not.toHaveBeenCalled();
  await open();
  await act(async () => api.openFile());
  expect(nextOpen).toHaveBeenCalledExactlyOnceWith("/project/file.ts", true, {
    workspaceEnv: { kind: "local" },
  });
});
it("does not let an older menu dismissal consume a newer opening", async () => {
  await render();
  await open();
  const retired = api;
  await act(async () => api.setOpen(false));
  await open();
  await act(async () => {
    retired.setOpen(false);
    api.openFile();
  });
  expect(input.onOpenFile).toHaveBeenCalledOnce();
});
it("refuses forced stage and discard while the row action is unavailable", async () => {
  input = { ...input, actionBusy: "commit" };
  await render();
  await open();
  await act(async () => api.stage());
  await open();
  await act(async () => api.discard());
  expect(input.onToggleStageFile).not.toHaveBeenCalled();
  expect(input.onDiscardFile).not.toHaveBeenCalled();
});
it("retires every captured action after a same-repository target change", async () => {
  await render();
  await open();
  const retired = api;
  const oldKey = api.key;
  input = { ...input, contextKey: "fixed" };
  await render();
  expect(api.key).not.toBe(oldKey);
  await act(async () => {
    retired.diff();
    retired.stage();
    retired.discard();
    retired.copyRelative();
    retired.openFile();
  });
  expect(input.onSelectFile).not.toHaveBeenCalled();
  expect(input.onToggleStageFile).not.toHaveBeenCalled();
  expect(input.onDiscardFile).not.toHaveBeenCalled();
  expect(input.onOpenFile).not.toHaveBeenCalled();
  expect(helpers.copy).not.toHaveBeenCalled();
});
it("preserves an opening after StrictMode replay and an equivalent descriptor publication", async () => {
  await render(true);
  await open();
  const key = api.key;
  await act(async () =>
    useWorkspaceEnvStore.setState({ env: { kind: "local" } }),
  );
  expect(api.key).toBe(key);
  await act(async () => api.openFile());
  expect(input.onOpenFile).toHaveBeenCalledOnce();
});
it("retains deleted files for diff and copy but refuses open and reveal", async () => {
  input = { ...input, entry: { ...input.entry, statusCode: "D" } };
  await render();
  await open();
  expect(api.canOpen).toBe(false);
  expect(api.canReveal).toBe(false);
  await act(async () => api.openFile());
  await open();
  await act(async () => api.reveal());
  expect(input.onOpenFile).not.toHaveBeenCalled();
  expect(helpers.reveal).not.toHaveBeenCalled();
  await open();
  await act(async () => api.copyRelative());
  expect(helpers.copy).toHaveBeenCalledExactlyOnceWith("file.ts");
  await open();
  await act(async () => api.diff());
  expect(input.onSelectFile).toHaveBeenCalledExactlyOnceWith(input.entry);
});
