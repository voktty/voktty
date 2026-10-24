// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownLink } from "@/modules/markdown/MarkdownLink";
import { MarkdownDocContext } from "@/modules/markdown/lib/docContext";
import {
  PATH_OPENING_EVENT,
  readPathOpeningRequest,
  type PathOpeningRequest,
} from "@/modules/surfaces/lib/pathOpeningRequest";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

let node: HTMLDivElement;
let root: Root;
let received: PathOpeningRequest[];
const receive = (event: Event) => {
  const request = readPathOpeningRequest((event as CustomEvent).detail);
  if (request) received.push(request);
};
async function clickLink() {
  const link = node.querySelector("a");
  if (!link) throw new Error("Expected rendered document link");
  await act(async () =>
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
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
it.each<[string, WorkspaceEnv, string, string, WorkspaceEnv]>([
  [
    "/project/docs/readme.md",
    { kind: "wsl", distro: "Ubuntu" },
    "../app.ts",
    "/project/app.ts",
    { kind: "wsl", distro: "Ubuntu" },
  ],
  [
    "/project/readme.md",
    {
      kind: "ssh",
      root: "/project",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    "app.ts",
    "/project/app.ts",
    {
      kind: "ssh",
      root: "/project",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
  ],
  [
    "remote://host/project/readme.md",
    LOCAL_WORKSPACE,
    "../other",
    "remote://host/other",
    LOCAL_WORKSPACE,
  ],
  [
    "/project/readme.md",
    { kind: "wsl", distro: "Ubuntu" },
    "C:/native/file.ts",
    "C:/native/file.ts",
    LOCAL_WORKSPACE,
  ],
])(
  "opens a rendered link under its document's filesystem: %s",
  async (docPath, workspaceEnv, href, path, workspace) => {
    await act(async () =>
      root.render(
        <MarkdownDocContext.Provider value={{ docPath, workspaceEnv }}>
          <MarkdownLink href={href}>Open</MarkdownLink>
        </MarkdownDocContext.Provider>,
      ),
    );
    await clickLink();
    expect(received).toEqual([{ path, workspace, kind: "unknown" }]);
  },
);
it("preserves a caller-vetoed link without emitting an opening request", async () => {
  await act(async () =>
    root.render(
      <MarkdownDocContext.Provider
        value={{ docPath: "/project/readme.md", workspaceEnv: LOCAL_WORKSPACE }}
      >
        <MarkdownLink href="app.ts" onClick={(event) => event.preventDefault()}>
          Open
        </MarkdownLink>
      </MarkdownDocContext.Provider>,
    ),
  );
  await clickLink();
  expect(received).toEqual([]);
});
