import { expect, it } from "vitest";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import {
  tabPreviewTarget,
  previewTargetUrl,
} from "@/modules/surfaces/lib/tabPreviewTarget";

const editor: Tab = {
  id: 1,
  ...createTabIdentity("source"),
  spaceId: "source",
  kind: "editor",
  title: "page",
  path: "/project/page #1.HTML",
  dirty: false,
  preview: false,
};
const environments: WorkspaceEnv[] = [
  {
    kind: "ssh",
    connection: { id: "host", name: "Remote", host: "example.test" },
    root: "/project",
  },
  { kind: "wsl", distro: "Debian" },
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Container",
      image: "image",
    },
  },
  { kind: "serial", portName: "COM3", baudRate: 9600 },
];

it("serves a document's directory and encodes its exact file name", () => {
  const target = tabPreviewTarget(editor);
  expect(target).toEqual({
    path: "/project",
    workspace: LOCAL_WORKSPACE,
    file: "page #1.HTML",
  });
  expect(previewTargetUrl("http://127.0.0.1:4000/", target?.file)).toBe(
    "http://127.0.0.1:4000/page%20%231.HTML",
  );
});

it.each(environments)(
  "does not reinterpret $kind document paths locally",
  (workspaceEnv) => {
    expect(tabPreviewTarget({ ...editor, workspaceEnv })).toBeNull();
    expect(
      tabPreviewTarget(editor, { root: "/wrong", env: workspaceEnv }),
    ).toBeNull();
  },
);

it.each(["C:/project/page.html", "//server/share/page.svg"])(
  "preserves native document ownership for %s",
  (path) => {
    expect(
      tabPreviewTarget({ ...editor, path, workspaceEnv: environments[0] }),
    ).toMatchObject({ workspace: LOCAL_WORKSPACE });
  },
);

it("rejects namespaces, relative roots and missing roots", () => {
  for (const path of [
    "remote://host/project/page.html",
    "relative/page.html",
    "bad\u0000/page.html",
  ])
    expect(tabPreviewTarget({ ...editor, path })).toBeNull();
  expect(
    tabPreviewTarget({
      id: 2,
      ...createTabIdentity("source"),
      spaceId: "source",
      kind: "harness",
      title: "Harness",
    }),
  ).toBeNull();
});

it("keeps an explicit Harness project independent from its surrounding workspace", () => {
  const harness: Tab = {
    id: 2,
    ...createTabIdentity("source"),
    spaceId: "source",
    kind: "harness",
    title: "Harness",
    cwd: "/project",
  };
  expect(
    tabPreviewTarget(harness, { root: "/wrong", env: environments[0] }),
  ).toMatchObject({ path: "/project", workspace: LOCAL_WORKSPACE });
  expect(
    tabPreviewTarget({ ...harness, cwd: "remote://host/project" }),
  ).toBeNull();
});
