import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";
import { runApiAgentLoop } from "./apiAgentLoop";

// Paths on the SSH host. The connection's authenticated root is wider than
// the project, so only the project boundary can refuse `/srv/other`.
const PROJECT = "/srv/app";
const io = vi.hoisted(() => ({
  // `link.ts` is a symlink on the host that resolves outside the project.
  canonicalize: vi.fn(async (path: string) =>
    path === "/srv/app/link.ts" ? "/srv/other/target.ts" : path,
  ),
  readFile: vi.fn(async () => ({ kind: "text" as const, content: "original", size: 8 })),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));

const remote = vi.hoisted(() => ({
  release: vi.fn(),
  acquire: vi.fn(async () => ({
    info: { session_id: 41, workspace_root: "/srv" },
    release: remote.release,
  })),
}));
vi.mock("@/modules/remote/sessionManager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/remote/sessionManager")>()),
  remoteSessions: { acquire: remote.acquire },
}));
vi.mock("@/modules/connections/model/remoteProjects", () => ({
  parseRemotePath: (path: string) =>
    path.startsWith("remote://env-box/")
      ? { environmentId: "env-box", hostPath: path.slice("remote://env-box".length) }
      : undefined,
  remoteProjectForPath: (path: string) =>
    path.startsWith("remote://env-box/srv/app")
      ? { key: "k", environmentId: "env-box", projectId: "p", cwd: PROJECT }
      : undefined,
}));
vi.mock("@/modules/connections/model/remoteSshProfiles", () => ({
  findSshProfile: (environmentId: string) =>
    environmentId === "env-box"
      ? { id: "box", name: "box", host: "box.lan", user: "root" }
      : undefined,
  remoteSshConnectionForProfile: (profile: { host: string }) => ({ host: profile.host }),
}));

import {
  acquireRemoteApiTools,
  apiToolContext,
  buildApiTools,
  forgetApiTools,
  type ApiToolTarget,
} from "./apiTools";

const SSH: WorkspaceEnv = {
  kind: "ssh",
  connection: { id: "box", name: "box", host: "box.lan", user: "root" },
  root: "/srv",
  sessionId: 41,
} as WorkspaceEnv;
const TARGET: ApiToolTarget = { root: PROJECT, workspace: SSH, shell: false };

beforeEach(() => vi.clearAllMocks());

async function call(name: string, value: Record<string, unknown>, approve = true) {
  const context = apiToolContext("ssh-fixture", `remote://env-box${PROJECT}`, "fixture", TARGET);
  if (!context) throw new Error("Missing context");
  let step = 0;
  const callId = crypto.randomUUID();
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      if (step++ === 0) {
        controller.enqueue({ type: "tool-input-start", id: callId, toolName: name });
        controller.enqueue({ type: "tool-call", toolCallId: callId, toolName: name, input: JSON.stringify(value) });
      }
      controller.enqueue({ type: "finish", usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 0, reasoning: 0 } }, finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined } });
      controller.close();
    },
  }) }) });
  return runApiAgentLoop({
    model,
    messages: [{ role: "user", content: "Work" }],
    tools: buildApiTools(context, { shell: false }),
    signal: new AbortController().signal,
    onEvent: () => {},
    onApproval: async () => approve,
  });
}

it("offers file and search tools over SSH but no shell", () => {
  const context = apiToolContext("ssh-shell", `remote://env-box${PROJECT}`, "fixture", TARGET);
  if (!context) throw new Error("Missing context");
  const names = Object.keys(buildApiTools(context, { shell: false }));
  expect(names).toEqual(expect.arrayContaining(["read_file", "edit", "grep", "glob"]));
  expect(names).not.toContain("bash_run");
});

it("reads and edits project files on the host through the SSH workspace", async () => {
  await call("read_file", { path: "file.ts" });
  await call("edit", { path: "file.ts", old_string: "original", new_string: "changed" });
  expect(io.readFile).toHaveBeenCalledWith("/srv/app/file.ts", SSH);
  expect(io.writeFile).toHaveBeenCalledWith("/srv/app/file.ts", "changed", SSH);
  await forgetApiTools("ssh-fixture");
});

it.each([
  ["read_file", "/srv/other/file.ts"],
  ["read_file", "/srv/app/link.ts"],
  ["read_file", "/srv/app/.env"],
  ["write_file", "/srv/other/file.ts"],
  ["write_file", "/srv/app/.env"],
])("refuses %s at %s on the host", async (name, path) => {
  const messages = await call(name, name === "write_file" ? { path, content: "x" } : { path });
  expect(JSON.stringify(messages)).toContain("Refused");
  expect(io.readFile).not.toHaveBeenCalled();
  expect(io.writeFile).not.toHaveBeenCalled();
  await forgetApiTools("ssh-fixture");
});

it("does not write when the edit is denied", async () => {
  await call("write_file", { path: "new.ts", content: "x" }, false);
  expect(io.writeFile).not.toHaveBeenCalled();
  await forgetApiTools("ssh-fixture");
});

it("holds one helper session rooted at the saved project for a turn", async () => {
  const lease = await acquireRemoteApiTools("remote://env-box/srv/app/src");
  expect(remote.acquire).toHaveBeenCalledWith(
    { profileId: "box", root: PROJECT },
    { host: "box.lan" },
  );
  expect(lease?.target).toEqual({
    root: "/srv/app/src",
    workspace: {
      kind: "ssh",
      connection: { id: "box", name: "box", host: "box.lan", user: "root" },
      root: "/srv",
      sessionId: 41,
    },
    shell: false,
  });
  lease?.release();
  lease?.release();
  expect(remote.release).toHaveBeenCalledOnce();
});

it("has no remote tools outside a saved SSH project", async () => {
  expect(await acquireRemoteApiTools("remote://env-box/srv/elsewhere")).toBeNull();
  expect(await acquireRemoteApiTools("remote://unknown/srv/app")).toBeNull();
  expect(remote.acquire).not.toHaveBeenCalled();
});
