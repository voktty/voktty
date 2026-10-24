// @vitest-environment happy-dom
import { expect, it } from "vitest";
import {
  pathOpeningRequest,
  readPathOpeningRequest,
  requestPathOpening,
  PATH_OPENING_EVENT,
} from "@/modules/surfaces/lib/pathOpeningRequest";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

it("copies the original SSH binding before asynchronous delivery", () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/project",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  const request = pathOpeningRequest("/project/file.ts", workspace);
  workspace.connection.host = "replacement.example";
  workspace.sessionId = 8;
  expect(request.workspace).toMatchObject({
    sessionId: 7,
    connection: { host: "build.example" },
  });
  expect(Object.isFrozen(request)).toBe(true);
});
it.each(["C:/project/file.ts", "\\\\server\\share\\file.ts"])(
  "keeps an explicit Windows file native even from WSL: %s",
  (path) => {
    expect(
      pathOpeningRequest(path, { kind: "wsl", distro: "Ubuntu" }).workspace,
    ).toEqual(LOCAL_WORKSPACE);
  },
);
it.each(["", "bad\npath", "bad\0path", "x".repeat(32769)])(
  "rejects invalid bounded paths",
  (path) => {
    expect(() => pathOpeningRequest(path, LOCAL_WORKSPACE)).toThrow(
      "Invalid path opening request",
    );
  },
);
it("limits event receipts to synchronous dispatch without keeping a replay entry", () => {
  let key: unknown;
  const capture = (event: Event) => {
    key = (event as CustomEvent).detail;
    expect(readPathOpeningRequest(key)).toMatchObject({
      path: "/native/file.ts",
      workspace: LOCAL_WORKSPACE,
    });
  };
  window.addEventListener(PATH_OPENING_EVENT, capture);
  try {
    requestPathOpening("/native/file.ts", LOCAL_WORKSPACE);
  } finally {
    window.removeEventListener(PATH_OPENING_EVENT, capture);
  }
  expect(readPathOpeningRequest(key)).toBeUndefined();
  expect(readPathOpeningRequest({ path: "/native/file.ts" })).toBeUndefined();
});
