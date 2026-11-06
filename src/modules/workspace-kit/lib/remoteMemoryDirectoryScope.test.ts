// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryClient } from "@/modules/workspace-kit/lib/memoryClient";
import {
  rememberRemoteProject,
  remotePath,
} from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { RemoteRequest } from "@/modules/remote/client";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  snapshot: vi.fn(),
  request: vi.fn(),
  native: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.native }));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: {
    acquire: io.acquire,
    snapshot: io.snapshot,
    subscribe: () => () => {},
  },
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemote: io.request,
}));
const profile = {
  id: "directory-memory",
  name: "Host",
  host: "host.invalid",
  port: 22,
};
const environmentId = "voktty-ssh-directory-memory";
const handle = { id: 1, token: "00000000-0000-4000-8000-000000000001" };
const environment = {
  kind: "ssh" as const,
  connection: profile,
  root: "/login",
  sessionId: 3,
};
let root: string;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  usePreferencesStore.setState({ sshConnections: [profile] });
  io.close.mockResolvedValue(undefined);
  io.acquire.mockImplementation(async (key) => {
    root = key.root;
    io.snapshot.mockReturnValue([{ key, sessionId: 17, closing: false }]);
    return {
      info: {
        session_id: 17,
        workspace_root: root,
        capabilities: ["memory.manage"],
      },
      release: () => {},
      releaseAndClose: io.close,
    };
  });
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) => {
    const operation = request.params?.operation;
    const result =
      operation === "open"
        ? handle
        : operation === "select"
          ? "00000000-0000-4000-8000-000000000002"
          : operation === "inspect"
            ? {
                schema: 1,
                root,
                blockedCount: 0,
                scope: { schema: 1, state: "ready", ancestryComplete: true },
              }
            : null;
    return {
      protocol: 2,
      id: request.id,
      ok: true,
      result: { schema: 1, ok: true, result },
    };
  });
});

it("scopes direct SSH memory to the selected directory after leaving the login root", async () => {
  const client = createMemoryClient({
    path: "/work/app",
    environment,
    source: "terminal:owned",
  });
  try {
    const selected = await client.select("/work/app", environment, {
      inspectAncestors: true,
    });
    expect((await client.inspect(selected)).root).toBe("/work/app");
    expect(io.acquire).toHaveBeenCalledWith(
      { profileId: profile.id, root: "/work/app" },
      expect.objectContaining({ host: profile.host }),
    );
    const requests = io.request.mock.calls.length;
    await expect(
      client.documents(selected, "/work/other"),
    ).rejects.toMatchObject({ code: "denied" });
    expect(io.request).toHaveBeenCalledTimes(requests);
  } finally {
    await client.close();
  }
  expect(io.close).toHaveBeenCalledOnce();
  expect(io.native).not.toHaveBeenCalled();
});

it("uses an attached Harness SSH owner without requiring a duplicate saved project", async () => {
  const env = { ...environment, root: "/work/app" };
  const path = remotePath(environmentId, "/work/app");
  const client = createMemoryClient({
    path,
    environment: env,
    source: "harness:owned",
  });
  try {
    const selected = await client.select(path, env);
    expect((await client.inspect(selected)).root).toBe(path);
    const requests = io.request.mock.calls.length;
    usePreferencesStore.setState({ sshConnections: [] });
    await expect(client.inspect(selected)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(io.request).toHaveBeenCalledTimes(requests);
  } finally {
    await client.close();
  }
  expect(io.request.mock.calls.every(([id]) => id === 17)).toBe(true);
  expect(io.close).toHaveBeenCalledOnce();
  expect(io.native).not.toHaveBeenCalled();
});

it("does not resolve an unknown project namespace from a local environment", async () => {
  const path = remotePath(environmentId, "/work/app");
  const client = createMemoryClient({
    path,
    environment: { kind: "local" },
    source: "unowned",
  });
  try {
    await expect(client.select(path, { kind: "local" })).rejects.toMatchObject({
      code: "unsupported",
    });
  } finally {
    await client.close();
  }
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it("keeps an attached Harness inside its root when a saved project owns a parent folder", async () => {
  rememberRemoteProject(environmentId, {
    id: "parent",
    name: "Parent",
    cwd: "/work",
  });
  const env = { ...environment, root: "/work/app" };
  const path = remotePath(environmentId, "/work/app/src");
  const client = createMemoryClient({
    path,
    environment: env,
    source: "harness:owned",
  });
  try {
    const selected = await client.select(path, env);
    expect((await client.inspect(selected)).root).toBe(
      remotePath(environmentId, env.root),
    );
    expect(io.acquire).toHaveBeenCalledWith(
      { profileId: profile.id, root: env.root },
      expect.objectContaining({ host: profile.host }),
    );
    await expect(
      client.documents(selected, remotePath(environmentId, "/work/other")),
    ).rejects.toMatchObject({ code: "denied" });
  } finally {
    await client.close();
  }
  expect(io.native).not.toHaveBeenCalled();
});

it("uses the captured SSH connection when its profile is not saved", async () => {
  usePreferencesStore.setState({ sshConnections: [] });
  const env = { ...environment, root: "/work/app" };
  const path = remotePath(environmentId, "/work/app");
  const client = createMemoryClient({
    path,
    environment: env,
    source: "attached",
  });
  try {
    const selected = await client.select(path, env);
    expect((await client.inspect(selected)).root).toBe(path);
  } finally {
    await client.close();
  }
  expect(io.native).not.toHaveBeenCalled();
});

it("rejects a namespace belonging to another SSH connection before acquiring a helper", async () => {
  const path = remotePath(environmentId, "/work/app");
  const env = {
    ...environment,
    connection: { ...profile, id: "other" },
    root: "/work/app",
  };
  const client = createMemoryClient({
    path,
    environment: env,
    source: "mismatched",
  });
  try {
    await expect(client.select(path, env)).rejects.toMatchObject({
      code: "denied",
    });
  } finally {
    await client.close();
  }
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it("refuses an attached namespace whose helper resolves outside its authenticated owner root", async () => {
  const path = remotePath(environmentId, "/work/other");
  const env = { ...environment, root: "/work/app" };
  const client = createMemoryClient({
    path,
    environment: env,
    source: "foreign",
  });
  try {
    await expect(client.select(path, env)).rejects.toMatchObject({
      code: "denied",
    });
  } finally {
    await client.close();
  }
  expect(io.request).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});
