import { expect, it } from "vitest";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { previewOpeningTarget } from "@/modules/preview/lib/previewOpeningTarget";

const document: Tab = {
  id: 1,
  ...createTabIdentity("source"),
  spaceId: "source",
  kind: "editor",
  title: "Page",
  path: "/project/page #1.HTML",
  dirty: false,
  preview: false,
  workspaceEnv: LOCAL_WORKSPACE,
};
it("preserves native directory names with trailing spaces", () => {
  expect(
    previewOpeningTarget("/project ", undefined, {
      root: null,
      env: LOCAL_WORKSPACE,
    }),
  ).toEqual({ kind: "server", root: "/project ", file: undefined });
});
it.each(["/project/page.html\n", "http://localhost:4000/page\n"])(
  "rejects control bytes instead of silently trimming %s",
  (target) => {
    expect(
      previewOpeningTarget(target, undefined, {
        root: null,
        env: LOCAL_WORKSPACE,
      }),
    ).toBeNull();
  },
);
it("uses the source document rather than its surrounding project", () => {
  expect(
    previewOpeningTarget("", document, {
      root: "/wrong",
      env: LOCAL_WORKSPACE,
    }),
  ).toEqual({ kind: "server", root: "/project", file: "page #1.HTML" });
});
it.each(["/page.html", "C:/page.html", "//host/share/page.html"])(
  "preserves filesystem roots for %s",
  (path) => {
    expect(
      previewOpeningTarget(path, undefined, {
        root: null,
        env: LOCAL_WORKSPACE,
      }),
    ).toMatchObject({ kind: "server", file: "page.html" });
  },
);
it.each<WorkspaceEnv>([
  {
    kind: "ssh",
    connection: { id: "host", name: "Host", host: "example.test" },
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
])(
  "does not reinterpret explicit $kind filesystem paths locally",
  (workspace) => {
    expect(
      previewOpeningTarget("/project/page.html", document, undefined, {
        root: "/project",
        workspace,
      }),
    ).toBeNull();
  },
);
it.each([
  "remote://host/project/page.html",
  "relative/page.html",
  "/project/../page.html",
  "/project/bad\u0000.html",
])("rejects unsupported path %s", (path) => {
  expect(
    previewOpeningTarget(path, undefined, { root: null, env: LOCAL_WORKSPACE }),
  ).toBeNull();
});
it.each(["https://example.test/page", "http://localhost:4000/page"])(
  "keeps explicit URL %s independent from filesystem support",
  (url) => {
    expect(
      previewOpeningTarget(
        url,
        { ...document, path: "remote://host/project/page.html" },
        undefined,
      ),
    ).toEqual({ kind: "url", url });
  },
);
it.each(["https://user:secret@example.test", "http://", "javascript:alert(1)"])(
  "rejects malformed or credential-bearing target %s",
  (target) => {
    expect(previewOpeningTarget(target, document, undefined)).toBeNull();
  },
);
