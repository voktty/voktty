// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnifiedDiffView } from "@/modules/harness/surfaces/UnifiedDiffView";
import { buildUnifiedFile } from "@/modules/harness/lib/unifiedDiff";
import {
  PATH_OPENING_EVENT,
  readPathOpeningRequest,
  type PathOpeningRequest,
} from "@/modules/surfaces/lib/pathOpeningRequest";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

vi.mock("@/modules/harness/surfaces/syntaxTokens", () => ({
  highlightDiffFile: vi.fn(async () => null),
}));
vi.mock("@/modules/harness/hooks/useColorScheme", () => ({
  useColorScheme: () => "dark",
}));
vi.mock("@/modules/harness/chrome/ExplorerMenu", () => ({
  ExplorerMenu: ({ onPick }: { onPick: (action: string) => void }) => (
    <button data-open-file type="button" onClick={() => onPick("open-file")}>
      Open
    </button>
  ),
}));
let node: HTMLDivElement;
let root: Root;
let received: PathOpeningRequest[];
const receive = (event: Event) => {
  const request = readPathOpeningRequest((event as CustomEvent).detail);
  if (request) received.push(request);
};
const diff = buildUnifiedFile("old\n", "new\n");
const files = [
  {
    id: "file.ts",
    path: "file.ts",
    label: "file.ts",
    additions: diff.additions,
    deletions: diff.deletions,
    blocks: diff.blocks,
  },
];
async function render(repoRoot: string, workspaceEnv: WorkspaceEnv) {
  await act(async () =>
    root.render(
      <UnifiedDiffView
        files={files}
        repoRoot={repoRoot}
        workspaceEnv={workspaceEnv}
      />,
    ),
  );
}
async function menu() {
  const target = [...node.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("file.ts"),
  );
  expect(target).toBeDefined();
  if (!target) throw new Error("Expected diff file header");
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  expect(node.querySelector("[data-open-file]")).not.toBeNull();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  received = [];
  window.addEventListener(PATH_OPENING_EVENT, receive);
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.removeEventListener(PATH_OPENING_EVENT, receive);
  node.remove();
  vi.unstubAllGlobals();
});
it.each<[string, WorkspaceEnv]>([
  ["/project", { kind: "wsl", distro: "Ubuntu" }],
  [
    "/project",
    {
      kind: "ssh",
      root: "/project",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
  ],
  ["remote://host/project", LOCAL_WORKSPACE],
])(
  "opens a diff file with its repository filesystem: %s",
  async (repoRoot, workspaceEnv) => {
    await render(repoRoot, workspaceEnv);
    await menu();
    await act(async () =>
      (node.querySelector("[data-open-file]") as HTMLButtonElement).click(),
    );
    expect(received).toEqual([
      { path: `${repoRoot}/file.ts`, workspace: workspaceEnv, kind: "file" },
    ]);
  },
);
it.each(["root", "workspace"])(
  "withdraws an open menu when its %s changes",
  async (change) => {
    await render("/project", LOCAL_WORKSPACE);
    await menu();
    await render(
      change === "root" ? "/replacement" : "/project",
      change === "workspace"
        ? { kind: "wsl", distro: "Ubuntu" }
        : LOCAL_WORKSPACE,
    );
    expect(node.querySelector("[data-open-file]")).toBeNull();
    expect(received).toEqual([]);
  },
);
