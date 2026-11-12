// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SourceControlWorkspace } from "@/modules/source-control/sourceControlWorkspace";
import { useBranchDropdown } from "@/modules/source-control/useBranchDropdown";
import { useBranchComparison } from "@/modules/source-control/useBranchComparison";
import { useGitCollectionMenu } from "@/modules/source-control/useGitCollectionMenu";
import { useConflictsPanel } from "@/modules/source-control/useConflictsPanel";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore } from "@/modules/workspace";

const native = vi.hoisted(() => ({
  gitListBranches: vi.fn(async () => ({ branches: [] })),
  gitOperationStatus: vi.fn(async () => ({ kind: "none" })),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native }));
const load = vi.fn(async () => [] as { name: string }[]);
const keyOf = (entry: { name: string }) => entry.name;
const refresh = () => {};
let branch: ReturnType<typeof useBranchDropdown>;
let collection: ReturnType<typeof useGitCollectionMenu<{ name: string }>>;
function Probe({ repoRoot }: { repoRoot: string }) {
  branch = useBranchDropdown({ repoRoot, contextKey: "project", onRefresh: refresh });
  collection = useGitCollectionMenu({ repoRoot, load, keyOf, onRefresh: refresh });
  useBranchComparison({ open: true, repoRoot, currentBranch: "main", contextKey: "project", onOpenChange: refresh });
  useConflictsPanel(repoRoot, [], refresh);
  return null;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each(["/local/project", "remote://voktty-ssh-other/work/project"])(
  "keeps branch, comparison, collection and conflict readers on the panel filesystem: %s",
  async (repoRoot) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useWorkspaceEnvStore.setState({ env: {
      kind: "ssh", root: "/ambient",
      connection: { id: "ambient", name: "Ambient", host: "ambient.example" },
    } });
    const root = createRoot(document.createElement("div"));
    cleanups.push(async () => { await act(async () => root.unmount()); });
    await act(async () => root.render(
      <SourceControlWorkspace value={LOCAL_WORKSPACE}><Probe repoRoot={repoRoot} /></SourceControlWorkspace>,
    ));
    await act(async () => {
      branch.setOpen(true);
      collection.setMenuOpen(true);
    });
    expect(native.gitListBranches).toHaveBeenCalledTimes(2);
    for (const args of native.gitListBranches.mock.calls) expect(args).toEqual([repoRoot, LOCAL_WORKSPACE]);
    expect(native.gitOperationStatus).toHaveBeenCalledWith(repoRoot, LOCAL_WORKSPACE);
    expect(load).toHaveBeenCalledExactlyOnceWith(repoRoot, LOCAL_WORKSPACE);
  },
);
