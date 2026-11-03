// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createMemoryClient } from "@/modules/workspace-kit/lib/memoryClient";
import type { RemoteRequest } from "@/modules/remote/client";
import {
  rememberRemoteProject,
  remotePath,
} from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  snapshot: vi.fn(),
  request: vi.fn(),
  native: vi.fn(),
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

it("uses the leased canonical root for SSH memory while preserving the saved alias and rejecting foreign roots", async () => {
  const connection = {
    id: "canonical-memory",
    name: "Host",
    host: "host.invalid",
    user: "owner",
    port: 22,
  };
  const alias = "/config/workspace/project";
  const canonical = "/workspace/project";
  const environmentId = "voktty-ssh-canonical-memory";
  localStorage.clear();
  usePreferencesStore.setState({ sshConnections: [connection] });
  rememberRemoteProject(environmentId, {
    id: "project",
    name: "Project",
    cwd: alias,
  });
  const info = {
    session_id: 31,
    workspace_root: canonical,
    architecture: "x86_64",
    helper_version: "1",
    capabilities: ["memory.manage"],
  };
  const close = vi.fn(async () => {});
  io.acquire.mockResolvedValue({
    info,
    release: () => {},
    releaseAndClose: close,
  });
  io.snapshot.mockReturnValue([
    {
      key: { profileId: connection.id, root: alias },
      sessionId: 31,
      closing: false,
    },
  ]);
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) => {
    const operation = request.params?.operation;
    const result =
      operation === "open"
        ? { id: 1, token: "00000000-0000-4000-8000-000000000001" }
        : operation === "select"
          ? "00000000-0000-4000-8000-000000000002"
          : operation === "inspect"
            ? {
                schema: 1,
                root: `${canonical}/sub`,
                blockedCount: 0,
                scope: { schema: 1, state: "ready", ancestryComplete: true },
              }
            : operation === "documents"
              ? {
                  schema: 1,
                  root: `${canonical}/sub`,
                  complete: true,
                  blockedCount: 0,
                  files: [],
                }
              : null;
    return {
      protocol: 2,
      id: request.id,
      ok: true,
      result: { schema: 1, ok: true, result },
    };
  });
  for (const { environment, namespace } of [
    { environment: { kind: "local" as const }, namespace: true },
    {
      environment: {
        kind: "ssh" as const,
        connection,
        root: alias,
        sessionId: 7,
      },
      namespace: false,
    },
    {
      environment: {
        kind: "ssh" as const,
        connection,
        root: canonical,
        sessionId: 7,
      },
      namespace: true,
    },
  ]) {
    const path = namespace
      ? remotePath(environmentId, `${alias}/sub`)
      : `${alias}/sub`;
    const client = createMemoryClient({
      path,
      environment,
      source: "owned-source",
    });
    try {
      const selected = await client.select(path, environment);
      const selects = io.request.mock.calls
        .map(([, request]) => request as RemoteRequest)
        .filter((request) => request.params?.operation === "select");
      expect(selects.slice(-1)[0]?.params?.path).toBe(`${canonical}/sub`);
      const observation = await client.inspect(selected);
      expect(observation.root).toBe(path);
      await client.documents(selected, path);
      expect(
        io.request.mock.calls
          .map(([, request]) => request as RemoteRequest)
          .filter((request) => request.params?.operation === "documents")
          .slice(-1)[0]?.params?.root,
      ).toBe(`${canonical}/sub`);
      const before = io.request.mock.calls.length;
      await expect(
        client.documents(
          selected,
          namespace ? remotePath(environmentId, "/foreign") : "/foreign",
        ),
      ).rejects.toMatchObject({ code: "denied" });
      expect(io.request).toHaveBeenCalledTimes(before);
      info.workspace_root = "/replacement";
      await expect(client.inspect(selected)).rejects.toMatchObject({
        code: "cancelled",
      });
      info.workspace_root = canonical;
      await expect(client.inspect(selected)).rejects.toMatchObject({
        code: "cancelled",
      });
    } finally {
      await client.close();
    }
  }
  const foreignEnvironment = {
    kind: "ssh" as const,
    connection,
    root: "/foreign",
    sessionId: 7,
  };
  const foreignPath = remotePath(environmentId, `${alias}/sub`);
  const foreign = createMemoryClient({
    path: foreignPath,
    environment: foreignEnvironment,
    source: "foreign-root",
  });
  try {
    const before = io.request.mock.calls.length;
    await expect(
      foreign.select(foreignPath, foreignEnvironment),
    ).rejects.toMatchObject({ code: "denied" });
    expect(io.request).toHaveBeenCalledTimes(before);
  } finally {
    await foreign.close();
  }
  expect(io.native).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(4);
});
