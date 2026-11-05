// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { createMemoryClient } from "@/modules/workspace-kit/lib/memoryClient";
import {
  createMemoryPanelController,
  type MemoryPanelState,
  type MemoryPanelTarget,
} from "@/modules/workspace-kit/lib/memoryPanel";
import { createMemoryIndicator } from "@/modules/workspace-kit/lib/memoryIndicator";
import { createNativeMemoryContext } from "@/modules/workspace-kit/lib/nativeMemoryContext";
import { createRemoteMemoryTransport } from "@/modules/workspace-kit/lib/remoteMemoryTransport";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";
import {
  RemoteSessionPool,
  type RemoteSessionPoolDeps,
} from "@/modules/remote/sessionPool";
import type { RemoteRequest } from "@/modules/remote/client";
import {
  rememberRemoteProject,
  REMOTE_PROJECTS_CHANGED,
} from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";

const io = vi.hoisted(() => ({
  request: vi.fn(),
  native: vi.fn(),
  acquire: vi.fn(),
  subscribe: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.native }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/remote/client", async (original) => ({
  ...(await original<typeof import("@/modules/remote/client")>()),
  requestRemote: io.request,
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: {
    acquire: io.acquire,
    subscribe: io.subscribe,
    snapshot: io.snapshot,
  },
}));

const profile = {
  id: "memory-host",
  name: "Memory host",
  host: "original.invalid",
  user: "owner",
  port: 22,
};
const target: MemoryPanelTarget = {
  path: "/project",
  source: "terminal:one",
  environment: {
    kind: "ssh",
    connection: profile,
    root: "/project",
    sessionId: 999,
  },
};
const namespace: MemoryPanelTarget = {
  path: "remote://voktty-ssh-memory-host/project",
  source: "harness:one",
  environment: { kind: "local" },
};
const connectedNamespace: MemoryPanelTarget = {
  ...namespace,
  environment: target.environment,
  source: "harness:connected",
};
const handle = { id: 1, token: "00000000-0000-4000-8000-000000000001" };
const contextHandle = { id: 2, token: "00000000-0000-4000-8000-000000000002" };
const publication = {
  schema: 1,
  created: [".voktty/kit.json"],
  skipped: [],
  migrated: [],
  cleaned: [],
};
const recoveryBackup =
  ".voktty/.voktty-migration-00000000-0000-4000-8000-000000000004-0";
const restoration = {
  schema: 1,
  created: [".voktty/.gitignore"],
  skipped: [],
  migrated: [],
  cleaned: [recoveryBackup],
};
let pool: RemoteSessionPool;
let open: Mock<RemoteSessionPoolDeps["open"]>;
let close: Mock<RemoteSessionPoolDeps["close"]>;
let initialized: boolean;
let nextSession: number;
let clients: ReturnType<typeof createMemoryClient>[];
let transports: ReturnType<typeof createRemoteMemoryTransport>[];
let contexts: ReturnType<typeof createNativeMemoryContext>[];
const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function client(input = target) {
  const value = createMemoryClient(input);
  clients.push(value);
  return value;
}
function packet() {
  return {
    schema: 1,
    decision: {
      schema: 1,
      policy: "manual",
      contextAllowed: true,
      captureAllowed: false,
      reason: "KIT_MEMORY_READY",
    },
    packet: {
      schema: 1,
      projectKey: "a".repeat(64),
      instructionDigest: "b".repeat(64),
      digest: "c".repeat(64),
      bytes: 7,
      contentState: "initial",
      text: "context",
    },
  };
}
function operation(params: Record<string, unknown>): unknown {
  switch (params.operation) {
    case "open":
      return handle;
    case "select":
      return "00000000-0000-4000-8000-000000000003";
    case "inspect":
    case "discover":
      return {
        schema: 1,
        root: initialized ? "/project" : null,
        blockedCount: 0,
        scope: {
          schema: 1,
          state: initialized ? "ready" : "reserved",
          ancestryComplete: true,
        },
      };
    case "preview":
      return {
        schema: 1,
        root: "/project",
        revision: params.revision,
        review: trustReply().review,
        deployment: { entries: [], canPublish: true, lock: null },
        isResuming: false,
        recoveryFiles: [],
        publicationBlocker: null,
      };
    case "confirm":
      initialized = true;
      return publication;
    case "reviewRecovery":
      return {
        schema: 1,
        root: "/project",
        revision: params.revision,
        review: trustReply().review,
        digest: "d".repeat(64),
        entries: [
          {
            target: ".voktty/.gitignore",
            backup: recoveryBackup,
            text: "*\r\n",
          },
        ],
      };
    case "confirmRecovery":
      return restoration;
    case "reviewTrust":
      return { ...trustReply(params.revision as number), root: "/project" };
    case "confirmTrust":
      return {
        schema: 1,
        preference: {
          projectKey: "a".repeat(64),
          policy: "manual",
          instructionDigest: "b".repeat(64),
        },
      };
    case "reviewPolicy":
      return {
        schema: 1,
        root: "/project",
        projectKey: "a".repeat(64),
        policy: params.policy,
        preference: null,
        revision: params.revision,
        review: trustReply().review,
      };
    case "confirmPolicy":
      return {
        schema: 1,
        preference: {
          projectKey: "a".repeat(64),
          policy: "never",
          instructionDigest: null,
        },
      };
    case "documents":
      return {
        schema: 1,
        root: "/project",
        complete: true,
        blockedCount: 0,
        files: [],
      };
    case "contextOpen":
      return contextHandle;
    case "contextBind":
      return { schema: 1, root: "/project" };
    case "contextRead":
      return packet();
    case "cancel":
    case "cancelTrust":
    case "cancelPolicy":
    case "cancelRecovery":
      return true;
    default:
      return null;
  }
}
function response(request: RemoteRequest, result: unknown) {
  return {
    protocol: 2,
    id: request.id,
    ok: true,
    result: { schema: 1, ok: true, result },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  clients = [];
  transports = [];
  contexts = [];
  initialized = false;
  nextSession = 7;
  localStorage.clear();
  usePreferencesStore.setState({ sshConnections: [profile] });
  rememberRemoteProject("voktty-ssh-memory-host", {
    id: "project",
    name: "Project",
    cwd: "/project",
  });
  open = vi.fn(async () => ({
    session_id: nextSession++,
    workspace_root: "/project",
    architecture: "x86_64",
    helper_version: "1",
    capabilities: ["memory.manage"],
  }));
  close = vi.fn(async () => {});
  pool = new RemoteSessionPool({
    open,
    close,
    idleMs: 30_000,
    schedule: () => () => {},
  });
  io.acquire.mockImplementation((...args: Parameters<typeof pool.acquire>) =>
    pool.acquire(...args),
  );
  io.snapshot.mockImplementation(() => pool.snapshot());
  io.subscribe.mockImplementation((listener: () => void) =>
    pool.subscribe(listener),
  );
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) =>
    response(request, operation(request.params ?? {})),
  );
});
afterEach(async () => {
  // Tests restore failing gates before reaching cleanup.
  await Promise.all(contexts.map((value) => value.close()));
  await Promise.all(clients.map((value) => value.close()));
  await Promise.all(transports.map((value) => value.release()));
  await pool.closeAll();
});

it("starts no native or SSH work until selection, including an unused close", async () => {
  const owner = client();
  expect(io.acquire).not.toHaveBeenCalled();
  await owner.close();
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it("captures the saved source before any delayed load and never adopts a new profile", async () => {
  const owner = client(namespace);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  await expect(
    owner.select(namespace.path, namespace.environment),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(io.acquire).not.toHaveBeenCalled();
});

it.each([target, namespace, connectedNamespace])(
  "renders SSH trust and policy effects for $source",
  async (input) => {
    initialized = true;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    try {
      await act(async () =>
        root.render(createElement(ProjectMemoryPanel, { target: input })),
      );
      expect(element.textContent).toContain("projectMemory.found");
      expect(element.textContent).not.toContain("projectMemory.unsupported");
      const review = [...element.querySelectorAll("button")].find(
        (button) => button.textContent === "projectMemory.reviewTrust",
      );
      expect(review).toBeDefined();
      await act(async () => review?.click());
      expect(
        [...element.querySelectorAll("pre")].map((pre) => pre.textContent),
      ).toContain(trustReply().instructions.files[0].fact.text);
      expect(element.textContent).toContain(input.path);
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.trustDescription",
      );
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.trustAccept",
      );
      expect(element.textContent).not.toContain(
        "projectMemory.trustDescription",
      );
      const click = async (label: string) => {
        const button = [...element.querySelectorAll("button")].find(
          (item) => item.textContent === label,
        );
        expect(button).toBeDefined();
        await act(async () => button?.click());
      };
      await click("common.back");
      await click("projectMemory.policyConfigure");
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.policyTitle",
      );
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.policyDescription",
      );
      const never = element.querySelector<HTMLInputElement>(
        'input[value="never"]',
      );
      expect(never).not.toBeNull();
      await act(async () => never?.click());
      await click("projectMemory.policyReview");
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.policyCurrent",
      );
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.policyRequested",
      );
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.policySaveEffects",
      );
      await click("projectMemory.sshSettings.policyConfirm");
      expect(element.textContent).toContain(
        "projectMemory.sshSettings.policySaved",
      );
      expect(io.native).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      element.remove();
      vi.unstubAllGlobals();
    }
    await vi.waitFor(() => expect(close).toHaveBeenCalledExactlyOnceWith(7));
  },
);

it.each([target, namespace, connectedNamespace])(
  "initializes SSH project files in one action without private setup for $source",
  async (input) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    const click = async (label: string) => {
      const button = [...element.querySelectorAll("button")].find(
        (item) => item.textContent === label,
      );
      expect(button).toBeDefined();
      await act(async () => button?.click());
    };
    try {
      await act(async () =>
        root.render(createElement(ProjectMemoryPanel, { target: input })),
      );
      await click("projectMemory.initialize");
      expect(element.textContent).toContain("projectMemory.installed");
      expect(element.querySelector("form")).toBeNull();
      expect(
        io.request.mock.calls.some(
          ([, request]) => request.params.operation === "initialize",
        ),
      ).toBe(false);
      expect(
        io.request.mock.calls.some(
          ([, request]) => request.params.operation === "confirm",
        ),
      ).toBe(true);
      expect(io.native).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ host: "original.invalid" }),
        "/project",
      );
    } finally {
      await act(async () => root.unmount());
      element.remove();
      vi.unstubAllGlobals();
    }
  },
);

it("rejects a namespace paired with another host before opening a helper", async () => {
  const input = {
    ...namespace,
    environment: {
      ...target.environment,
      kind: "ssh" as const,
      root: "/project",
      connection: { ...profile, host: "wrong.invalid" },
    },
  };
  const owner = client(input);
  await expect(
    owner.select(input.path, input.environment),
  ).rejects.toMatchObject({ code: "denied" });
  expect(io.acquire).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
});

it.each([target, namespace, connectedNamespace])(
  "initializes existing reserved memory through the shared panel for $source",
  async (input) => {
    const states: MemoryPanelState[] = [];
    const panel = createMemoryPanelController(input, (state) =>
      states.push(state),
    );
    await panel.load();
    expect(last(states)).toMatchObject({
      status: "ready",
      observation: { root: null, scope: { state: "reserved" } },
    });
    expect(
      io.request.mock.calls.map(([, request]) => request.params.operation),
    ).toEqual(["open", "select", "inspect"]);
    await panel.configure();
    expect(last(states)).toEqual({
      status: "published",
      root: input.path,
      report: publication,
    });
    await panel.load();
    await panel.browseDocuments();
    expect(last(states)).toMatchObject({
      status: "documentsReady",
      snapshot: { root: input.path },
    });
    await panel.dispose();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ host: "original.invalid" }),
      "/project",
    );
    expect(io.request.mock.calls.every(([id]) => id === 7)).toBe(true);
    expect(io.native).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledExactlyOnceWith(7);
  },
);

it("uses SSH for the shared indicator and never initializes private state during inspection", async () => {
  initialized = true;
  const publish = vi.fn();
  const indicator = createMemoryIndicator(namespace, publish);
  await indicator.load();
  expect(publish).toHaveBeenLastCalledWith("found");
  expect(
    io.request.mock.calls.map(([, request]) => request.params.operation),
  ).toEqual(["open", "select", "inspect"]);
  await indicator.dispose();
  expect(io.native).not.toHaveBeenCalled();
});

it("maps trust and policy receipts without changing instruction bytes or digests", async () => {
  const owner = client(namespace);
  const selected = await owner.select(namespace.path, namespace.environment);
  const trust = await owner.reviewTrust(selected);
  expect(trust.snapshot.root).toBe(namespace.path);
  expect(trust.snapshot.instructions).toEqual(trustReply().instructions);
  expect(trust.snapshot.fingerprint).toEqual(trustReply().fingerprint);
  await owner.confirmTrust(selected, trust);
  const policy = await owner.reviewPolicy(selected, "never");
  await owner.confirmPolicy(selected, policy);
  expect(last(io.request.mock.calls)?.[1].params).toEqual({
    operation: "confirmPolicy",
    handle,
    selection: "00000000-0000-4000-8000-000000000003",
    review: trustReply().review,
  });
});

it.each([target, namespace, connectedNamespace])(
  "reviews and restores through the captured SSH helper for $source",
  async (input) => {
    const owner = client(input);
    const selected = await owner.select(input.path, input.environment);
    const review = await owner.reviewRecovery(selected, {
      destination: input.path,
      environment: input.environment,
    });
    expect(review.snapshot.root).toBe(input.path);
    expect(review.snapshot.entries).toEqual([
      { target: ".voktty/.gitignore", backup: recoveryBackup, text: "*\r\n" },
    ]);
    expect(last(io.request.mock.calls)?.[1].params).toEqual({
      operation: "reviewRecovery",
      handle,
      selection: "00000000-0000-4000-8000-000000000003",
      revision: 1,
    });
    expect(await owner.confirmRecovery(selected, review)).toEqual(restoration);
    expect(last(io.request.mock.calls)?.[1].params).toEqual({
      operation: "confirmRecovery",
      handle,
      selection: "00000000-0000-4000-8000-000000000003",
      review: trustReply().review,
      digest: "d".repeat(64),
    });
    await expect(owner.confirmRecovery(selected, review)).rejects.toMatchObject(
      {
        code: "cancelled",
      },
    );
    expect(io.native).not.toHaveBeenCalled();
  },
);

it("maps recovery cancellation on the shared deployment revision and retires its receipt", async () => {
  const owner = client(namespace);
  const selected = await owner.select(namespace.path, namespace.environment);
  const review = await owner.reviewRecovery(selected, {
    destination: namespace.path,
    environment: namespace.environment,
  });
  expect(await owner.cancelRecovery(selected)).toBe(true);
  expect(last(io.request.mock.calls)?.[1].params).toEqual({
    operation: "cancelRecovery",
    handle,
    selection: "00000000-0000-4000-8000-000000000003",
    revision: 1,
  });
  await expect(owner.confirmRecovery(selected, review)).rejects.toMatchObject({
    code: "cancelled",
  });
  const fresh = await owner.reviewRecovery(selected, {
    destination: namespace.path,
    environment: namespace.environment,
  });
  expect(last(io.request.mock.calls)?.[1].params.revision).toBe(2);
  expect(await owner.confirmRecovery(selected, fresh)).toEqual(restoration);
});

it.each([target, namespace, connectedNamespace])(
  "restores from a partial SSH scope through the panel without initializing private state for $source",
  async (input) => {
    let restored = false;
    io.request.mockImplementation(
      async (_id: number, request: RemoteRequest) => {
        if (request.params?.operation === "confirmRecovery") restored = true;
        const result =
          request.params?.operation === "inspect" && !restored
            ? {
                schema: 1,
                root: null,
                blockedCount: 1,
                scope: { schema: 1, state: "partial", ancestryComplete: true },
              }
            : operation(request.params ?? {});
        return response(request, result);
      },
    );
    const states: MemoryPanelState[] = [];
    const panel = createMemoryPanelController(input, (state) =>
      states.push(state),
    );
    try {
      await panel.load();
      expect(last(states)).toMatchObject({
        status: "ready",
        observation: { scope: { state: "partial" } },
      });
      await panel.reviewRecovery();
      const reviewed = last(states);
      expect(reviewed?.status).toBe("recoveryReview");
      if (reviewed?.status !== "recoveryReview")
        throw new Error("Missing recovery review");
      await panel.confirmRecovery(reviewed.review);
      expect(last(states)).toEqual({
        status: "recoveryRestored",
        root: input.path,
        report: restoration,
      });
      await panel.resumeInitialization();
      expect(last(states)).toEqual({ status: "configuring", recovering: true });
      expect(
        io.request.mock.calls.map(([, request]) => request.params.operation),
      ).toEqual([
        "open",
        "select",
        "inspect",
        "reviewRecovery",
        "confirmRecovery",
        "inspect",
      ]);
      expect(io.native).not.toHaveBeenCalled();
    } finally {
      await panel.dispose();
    }
  },
);

it("rejects a late recovery review after a profile round trip and cleans up the original helper", async () => {
  const owner = client(namespace);
  const selected = await owner.select(namespace.path, namespace.environment);
  const gate = deferred<void>();
  const started = deferred<void>();
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) => {
    if (request.params?.operation === "reviewRecovery") {
      started.resolve();
      await gate.promise;
    }
    return response(request, operation(request.params ?? {}));
  });
  const pending = owner.reviewRecovery(selected, {
    destination: namespace.path,
    environment: namespace.environment,
  });
  const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  usePreferencesStore.setState({ sshConnections: [] });
  usePreferencesStore.setState({ sshConnections: [profile] });
  gate.resolve();
  await rejected;
  expect(
    io.request.mock.calls.some(
      ([, request]) => request.params.operation === "confirmRecovery",
    ),
  ).toBe(false);
  await owner.close();
  expect(close).toHaveBeenCalledExactlyOnceWith(7);
  expect(io.native).not.toHaveBeenCalled();
});

it("keeps an older helper's recovery rejection on SSH without native fallback", async () => {
  const owner = client();
  const selected = await owner.select(target.path, target.environment);
  io.request.mockImplementationOnce(
    async (_id: number, request: RemoteRequest) => ({
      protocol: 2,
      id: request.id,
      ok: false,
      error: { code: "invalid_params", message: "untrusted host details" },
    }),
  );
  await expect(
    owner.reviewRecovery(selected, {
      destination: target.path,
      environment: target.environment,
    }),
  ).rejects.toMatchObject({
    code: "unavailable",
    message: "Project memory unavailable",
  });
  expect(io.native).not.toHaveBeenCalled();
});

it.each([target, namespace, connectedNamespace])(
  "retains the original helper for accepted context after panel closure for $source",
  async (input) => {
    const owner = client(input);
    const selected = await owner.select(input.path, input.environment);
    const review = await owner.reviewTrust(selected);
    const context = createNativeMemoryContext(() => true);
    contexts.push(context);
    await owner.bindContext(selected, review, context, "enabled");
    await owner.close();
    expect(close).not.toHaveBeenCalled();
    expect(await context.read()).toEqual(packet());
    await context.close();
    expect(close).toHaveBeenCalledExactlyOnceWith(7);
    expect(open).toHaveBeenCalledOnce();
    expect(io.native).not.toHaveBeenCalled();
  },
);

it("does not release a sibling lease when closing its last memory owner", async () => {
  const sibling = await pool.acquire(
    { profileId: profile.id, root: "/project" },
    profile,
  );
  const owner = client();
  await owner.select(target.path, target.environment);
  await owner.close();
  expect(close).not.toHaveBeenCalled();
  expect(pool.snapshot()[0]?.leases).toBe(1);
  await sibling.releaseAndClose?.();
  expect(close).toHaveBeenCalledExactlyOnceWith(7);
});

it("retries context lease cleanup after native context close was acknowledged", async () => {
  const owner = client();
  const selected = await owner.select(target.path, target.environment);
  const review = await owner.reviewTrust(selected);
  const context = createNativeMemoryContext(() => true);
  contexts.push(context);
  await owner.bindContext(selected, review, context, "enabled");
  await owner.close();
  close.mockRejectedValueOnce({ code: "cancelled" });
  await expect(context.close()).rejects.toMatchObject({ code: "cancelled" });
  await expect(context.read()).rejects.toMatchObject({ code: "cancelled" });
  await context.close();
  expect(close).toHaveBeenCalledTimes(2);
  expect(
    io.request.mock.calls.filter(
      ([, request]) => request.params.operation === "contextClose",
    ),
  ).toHaveLength(1);
});

it.each([
  { ...namespace, path: "remote://unknown/project" },
  { ...namespace, path: "remote://voktty-ssh-memory-host/project/../outside" },
  { ...namespace, path: "remote://voktty-ssh-memory-host/project\\secret" },
  { ...target, path: "/outside" },
])(
  "rejects unowned or escaping sources before acquiring a helper: $path",
  async (input) => {
    const owner = client(input);
    await expect(
      owner.select(input.path, input.environment),
    ).rejects.toHaveProperty("code");
    expect(io.acquire).not.toHaveBeenCalled();
    expect(io.native).not.toHaveBeenCalled();
  },
);

it("rejects old helpers without sending memory RPCs or falling back locally", async () => {
  open.mockResolvedValueOnce({
    session_id: 7,
    workspace_root: "/project",
    architecture: "x86_64",
    helper_version: "old",
    capabilities: [],
  });
  const owner = client();
  await expect(
    owner.select(target.path, target.environment),
  ).rejects.toMatchObject({ code: "unsupported" });
  await owner.close();
  expect(io.request).not.toHaveBeenCalled();
  expect(io.native).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledExactlyOnceWith(7);
});

it("permanently retires namespace receipts after a saved profile round trip", async () => {
  const owner = client(namespace);
  const selected = await owner.select(namespace.path, namespace.environment);
  const review = await owner.reviewTrust(selected);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "other.invalid" }],
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  const before = io.request.mock.calls.length;
  await expect(owner.confirmTrust(selected, review)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(owner.isCurrent(selected)).toBe(false);
  expect(io.request).toHaveBeenCalledTimes(before);
  await owner.close();
  expect(last(io.request.mock.calls)?.[0]).toBe(7);
  expect(last(io.request.mock.calls)?.[1].params.operation).toBe("close");
});

it("retires namespace receipts after a project removal even if restored immediately", async () => {
  const owner = client(namespace);
  const selected = await owner.select(namespace.path, namespace.environment);
  localStorage.clear();
  window.dispatchEvent(new Event(REMOTE_PROJECTS_CHANGED));
  rememberRemoteProject("voktty-ssh-memory-host", {
    id: "project",
    name: "Project",
    cwd: "/project",
  });
  await expect(owner.inspect(selected)).rejects.toMatchObject({
    code: "cancelled",
  });
});

it("never reconnects or moves receipts after the original helper is closed", async () => {
  const owner = client();
  const selected = await owner.select(target.path, target.environment);
  await pool.closeSession(7);
  await pool.acquire({ profileId: profile.id, root: "/project" }, profile);
  await expect(owner.inspect(selected)).rejects.toMatchObject({
    code: "cancelled",
  });
  await owner.close();
  expect(last(io.request.mock.calls)?.[0]).toBe(7);
  expect(open).toHaveBeenCalledTimes(2);
});

it("keeps a late open handle addressable for cleanup after profile retirement", async () => {
  const gate = deferred<void>();
  const started = deferred<void>();
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) => {
    if (request.params?.operation === "open") {
      started.resolve();
      await gate.promise;
    }
    return response(request, operation(request.params ?? {}));
  });
  const owner = client(namespace);
  const selection = owner.select(namespace.path, namespace.environment);
  const rejected = expect(selection).rejects.toMatchObject({
    code: "cancelled",
  });
  await started.promise;
  usePreferencesStore.setState({ sshConnections: [] });
  const closing = owner.close();
  gate.resolve();
  await rejected;
  await closing;
  expect(
    io.request.mock.calls.map(([, request]) => request.params.operation),
  ).toEqual(["open", "close"]);
  expect(close).toHaveBeenCalledExactlyOnceWith(7);
});

it("waits for a retired in-flight read before releasing its helper lease", async () => {
  const gate = deferred<void>();
  const started = deferred<void>();
  const owner = client();
  const selected = await owner.select(target.path, target.environment);
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) => {
    if (request.params?.operation === "inspect") {
      started.resolve();
      await gate.promise;
    }
    return response(request, operation(request.params ?? {}));
  });
  const read = owner.inspect(selected);
  const rejected = expect(read).rejects.toMatchObject({ code: "cancelled" });
  await started.promise;
  const closing = owner.close();
  await vi.waitFor(() =>
    expect(last(io.request.mock.calls)?.[1].params.operation).toBe("close"),
  );
  expect(close).not.toHaveBeenCalled();
  gate.resolve();
  await rejected;
  await closing;
  expect(close).toHaveBeenCalledExactlyOnceWith(7);
});

it("retries exact helper cleanup without reopening or repeating acknowledged native close", async () => {
  const owner = client();
  await owner.select(target.path, target.environment);
  close.mockRejectedValueOnce({ code: "cancelled" });
  await expect(owner.close()).rejects.toMatchObject({ code: "cancelled" });
  expect(pool.snapshot()[0]?.closing).toBe(true);
  await owner.close();
  expect(open).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledTimes(2);
  expect(
    io.request.mock.calls.filter(
      ([, request]) => request.params.operation === "close",
    ),
  ).toHaveLength(1);
});

it("validates correlation and the inner envelope and sanitizes publication failures", async () => {
  const owner = client();
  const selected = await owner.select(target.path, target.environment);
  for (const broken of [
    { protocol: 1, id: "wrong", ok: true, result: null },
    { schema: 2, ok: true, result: null },
    { schema: 1, ok: "true", result: null },
  ]) {
    io.request.mockImplementationOnce(
      async (_id: number, request: RemoteRequest) =>
        "protocol" in broken
          ? broken
          : { protocol: 2, id: request.id, ok: true, result: broken },
    );
    await expect(owner.inspect(selected)).rejects.toMatchObject({
      code: "unavailable",
    });
  }
  const review = await owner.preview(selected, {
    destination: target.path,
    environment: target.environment,
    inputs: {},
    links: { agents: false, claude: false },
  });
  const changes = {
    created: [".voktty/INIT.md"],
    migrated: [],
    cleaned: [],
    possibleRecoveryFiles: [".voktty/recovery/file"],
  };
  io.request.mockImplementationOnce(
    async (_id: number, request: RemoteRequest) => ({
      protocol: 2,
      id: request.id,
      ok: true,
      result: {
        schema: 1,
        ok: false,
        error: { code: "stale", message: "private details", changes },
      },
    }),
  );
  await expect(owner.confirmPreview(selected, review)).rejects.toMatchObject({
    code: "stale",
    changes,
    message: "Project memory stale",
  });
});

it("rejects foreign destinations, host roots and commands before remote IO", async () => {
  const transport = createRemoteMemoryTransport(namespace);
  transports.push(transport);
  for (const [command, args] of [
    ["shell", {}],
    [
      "project_memory_select",
      { path: target.path, environment: target.environment, revision: 1 },
    ],
    [
      "project_memory_preview",
      {
        request: {
          destination: "remote://other/project",
          environment: { kind: "local" },
        },
      },
    ],
    ["project_memory_documents", { root: "remote://other/project" }],
    [
      "project_memory_review_recovery",
      {
        request: {
          destination: "remote://other/project",
          environment: { kind: "local" },
          revision: 1,
        },
      },
    ],
  ] as const)
    await expect(transport.invoke(command, args)).rejects.toHaveProperty(
      "code",
    );
  expect(io.request).not.toHaveBeenCalled();
  expect(io.acquire).not.toHaveBeenCalled();
});

it("shares a bounded request budget across retained context owners through settlement", async () => {
  const transport = createRemoteMemoryTransport(target);
  const retained = transport.retain();
  transports.push(transport, retained);
  await transport.invoke("project_memory_open");
  const gate = deferred<void>();
  io.request.mockImplementation(async (_id: number, request: RemoteRequest) => {
    await gate.promise;
    return response(request, operation(request.params ?? {}));
  });
  const reads = Array.from({ length: 256 }, (_, index) =>
    (index % 2 ? retained : transport).invoke("project_memory_context_read", {
      handle: contextHandle,
    }),
  );
  const settled = Promise.allSettled(reads);
  await vi.waitFor(() => expect(io.request).toHaveBeenCalledTimes(257));
  await expect(
    retained.invoke("project_memory_context_read", { handle: contextHandle }),
  ).rejects.toMatchObject({ code: "busy" });
  const releasing = transport.release();
  await expect(
    retained.invoke("project_memory_context_read", { handle: contextHandle }),
  ).rejects.toMatchObject({ code: "busy" });
  expect(close).not.toHaveBeenCalled();
  gate.resolve();
  await settled;
  await releasing;
  expect(close).not.toHaveBeenCalled();
  await retained.release();
  expect(close).toHaveBeenCalledExactlyOnceWith(7);
});

it("keeps failed native resource close retryable on its original helper", async () => {
  const owner = client();
  await owner.select(target.path, target.environment);
  io.request.mockImplementationOnce(
    async (_id: number, request: RemoteRequest) => ({
      protocol: 2,
      id: request.id,
      ok: true,
      result: { schema: 1, ok: false, error: { code: "busy" } },
    }),
  );
  await expect(owner.close()).rejects.toMatchObject({ code: "busy" });
  expect(close).not.toHaveBeenCalled();
  await owner.close();
  expect(
    io.request.mock.calls.filter(
      ([, request]) => request.params.operation === "close",
    ),
  ).toHaveLength(2);
  expect(close).toHaveBeenCalledExactlyOnceWith(7);
});
