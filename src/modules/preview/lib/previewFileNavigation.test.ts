import { expect, it } from "vitest";
import {
  previewRelativePath,
  previewFileNavigation,
} from "@/modules/preview/lib/previewFileNavigation";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

it.each([
  ["/work", "/work/page #1.html", "page%20%231.html"],
  ["/", "/page.html", "page.html"],
  ["C:/", "c:/page.html", "page.html"],
  ["C:\\work", "c:\\WORK\\page.html", "page.html"],
  ["//host/share", "//HOST/share/folder/file.svg", "folder/file.svg"],
  ["/work", "/worker/page.html", null],
  ["/work", "/WORK/page.html", null],
  ["/work", "/work/../private/page.html", null],
  ["/work", "remote://host/work/page.html", null],
  ["relative", "/work/page.html", null],
  ["/work", "/work/bad\u0000.html", null],
])("resolves native path boundaries for %s and %s", (root, file, expected) => {
  expect(previewRelativePath(root, file)).toBe(expected);
});
const server = (root_path: string, port: number) => ({
  root_path,
  port,
  url: `http://127.0.0.1:${port}`,
  server_type: "static" as const,
});
it("selects the closest matching server rather than another path prefix", () => {
  expect(
    previewFileNavigation(
      "/work/app2/page.html",
      "/work",
      LOCAL_WORKSPACE,
      [
        server("/work/app", 4000),
        server("/work", 4001),
        server("/work/app2", 4002),
      ],
      "about:blank",
    ),
  ).toEqual({ kind: "navigate", url: "http://127.0.0.1:4002/page.html" });
});
it("keeps dev-server navigation under the captured root and encodes segments", () => {
  expect(
    previewFileNavigation(
      "/work/folder/page?.html",
      "/work",
      LOCAL_WORKSPACE,
      [],
      "http://localhost:4000/old",
    ),
  ).toEqual({
    kind: "navigate",
    url: "http://localhost:4000/folder/page%3F.html",
  });
});
it("starts the containing directory when a file is outside the captured root", () => {
  expect(
    previewFileNavigation(
      "/worker/page.html",
      "/work",
      LOCAL_WORKSPACE,
      [],
      "http://localhost:4000/old",
    ),
  ).toEqual({ kind: "start", root: "/worker", relative: "page.html" });
});
it("preserves a native drive root without Explorer metadata", () => {
  expect(
    previewFileNavigation(
      "C:/page.html",
      null,
      LOCAL_WORKSPACE,
      [],
      "about:blank",
    ),
  ).toEqual({ kind: "start", root: "C:/", relative: "page.html" });
});
it.each<WorkspaceEnv>([
  { kind: "wsl", distro: "Debian" },
  {
    kind: "ssh",
    connection: { id: "host", name: "Host", host: "example.test" },
    root: "/work",
  },
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Container",
      image: "image",
    },
  },
  { kind: "serial", portName: "COM3", baudRate: 9600 },
])("refuses to treat $kind Explorer paths as local files", (workspace) => {
  expect(
    previewFileNavigation(
      "/work/page.html",
      "/work",
      workspace,
      [server("/work", 4000)],
      "http://localhost:4000",
    ),
  ).toBeNull();
});
