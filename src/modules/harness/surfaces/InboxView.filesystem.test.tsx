// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxDetailPane } from "@/modules/harness/surfaces/InboxView";
import { setInboxSelection } from "@/modules/harness/lib/inboxSelection";
import type { InboxItem } from "@/modules/harness/lib/githubTasks";
import {
  PATH_OPENING_EVENT,
  readPathOpeningRequest,
  type PathOpeningRequest,
} from "@/modules/surfaces/lib/pathOpeningRequest";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";

const mocks = vi.hoisted(() => ({
  diff: {
    additions: 1,
    deletions: 1,
    files: [{ path: "src/app.ts", additions: 1, deletions: 1 }],
    patch: "",
    truncated: false,
  },
}));
vi.mock("@/modules/harness/lib/githubTasks", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/githubTasks")>()),
  peekGithubWorkItemDetails: () => ({ body: "", author: "" }),
  githubWorkItemDetails: async () => ({ body: "", author: "" }),
  peekGithubWorkItemThread: () => ({}),
  githubWorkItemThread: async () => ({}),
  peekGithubPrDiff: () => mocks.diff,
  githubPrDiff: async () => mocks.diff,
}));
vi.mock("@/modules/harness/hooks/useTabGroupLogos", () => ({
  useTabGroupLogos: () => ({}),
}));
vi.mock("@/modules/harness/surfaces/AgentMarkdown", () => ({
  AgentMarkdown: () => null,
}));
vi.mock("@/modules/harness/surfaces/InboxComments", () => ({
  InboxComments: () => null,
  InboxCommentForm: () => null,
}));
vi.mock("@/modules/harness/surfaces/InboxPrOverview", () => ({
  InboxDescriptionSummary: () => null,
  InboxPrChangesGlance: () => null,
}));
vi.mock("@/modules/harness/chrome/TitleBar", () => ({
  OverlayNav: () => null,
}));
vi.mock("@/modules/harness/surfaces/InboxDiscussionPanel", () => ({
  InboxDiscussionPanel: () => null,
}));
vi.mock("@/modules/harness/surfaces/syntaxTokens", () => ({
  highlightDiffFile: async () => null,
}));
vi.mock("@/modules/harness/hooks/useColorScheme", () => ({
  useColorScheme: () => "dark",
}));
vi.mock("@/modules/harness/chrome/ExplorerMenu", () => ({
  ExplorerMenu: ({ onPick }: { onPick: (action: string) => void }) => (
    <button type="button" data-open-file onClick={() => onPick("open-file")}>
      Open
    </button>
  ),
}));

let node: HTMLDivElement;
let root: Root;
let received: PathOpeningRequest[];
const previousLanguage = usePreferencesStore.getState().language;
const previousWorkspace = useWorkspaceEnvStore.getState().env;
const receive = (event: Event) => {
  const request = readPathOpeningRequest((event as CustomEvent).detail);
  if (request) received.push(request);
};
function item(projectPath: string, number = 1): InboxItem {
  return {
    provider: "github",
    kind: "pr",
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    projectPath,
    state: "OPEN",
    updatedAt: "2026-10-24",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/app",
  };
}
function buttonWithText(text: string) {
  const button = [...node.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}
async function showCode() {
  await act(async () => buttonWithText("Code").click());
}
async function showFileMenu() {
  await act(async () =>
    buttonWithText("src/app.ts").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  expect(node.querySelector("[data-open-file]")).not.toBeNull();
}
async function openFile() {
  const button = node.querySelector<HTMLButtonElement>("[data-open-file]");
  if (!button) throw new Error("Missing file menu");
  await act(async () => button.click());
}
async function render(projectPath: string) {
  setInboxSelection(item(projectPath));
  await act(async () =>
    root.render(
      <StrictMode>
        <InboxDetailPane cwd="/ambient/project" recents={[]} />
      </StrictMode>,
    ),
  );
  await showCode();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePreferencesStore.setState({ language: "en" });
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ubuntu" } });
  received = [];
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  window.addEventListener(PATH_OPENING_EVENT, receive);
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.removeEventListener(PATH_OPENING_EVENT, receive);
  setInboxSelection(null);
  node.remove();
  usePreferencesStore.setState({ language: previousLanguage });
  useWorkspaceEnvStore.setState({ env: previousWorkspace });
  vi.unstubAllGlobals();
});

it.each([
  "/work/project",
  "C:/work/project",
  "//server/share/project",
  "remote://voktty-ssh-build/work/project",
])(
  "opens a PR file under its own project while another filesystem is selected: %s",
  async (projectPath) => {
    await render(projectPath);
    await showFileMenu();
    await openFile();
    expect(received).toEqual([
      {
        path: `${projectPath}/src/app.ts`,
        workspace: LOCAL_WORKSPACE,
        kind: "file",
      },
    ]);
    expect(useWorkspaceEnvStore.getState().env).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
  },
);
it.each([1, 2])(
  "retires the previous project's menu when selecting PR %s in another project",
  async (number) => {
    await render("/work/first");
    await showFileMenu();
    await act(async () =>
      setInboxSelection(item("remote://host/work/second", number)),
    );
    expect(node.querySelector("[data-open-file]")).toBeNull();
    expect(received).toEqual([]);
    await showCode();
    await showFileMenu();
    await openFile();
    expect(received).toEqual([
      {
        path: "remote://host/work/second/src/app.ts",
        workspace: LOCAL_WORKSPACE,
        kind: "file",
      },
    ]);
  },
);
it("preserves the current menu's project through metadata and ambient filesystem changes", async () => {
  await render("/work/owner");
  await showFileMenu();
  await act(async () => {
    setInboxSelection({ ...item("/work/owner"), title: "Updated title" });
    useWorkspaceEnvStore.setState({
      env: {
        kind: "ssh",
        root: "/ambient",
        sessionId: 7,
        connection: { id: "build", name: "Build", host: "build.example" },
      },
    });
  });
  await openFile();
  expect(received).toEqual([
    {
      path: "/work/owner/src/app.ts",
      workspace: LOCAL_WORKSPACE,
      kind: "file",
    },
  ]);
});
