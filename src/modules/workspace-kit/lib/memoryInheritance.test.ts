import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryConversations } from "@/modules/workspace-kit/lib/memoryConversations";
import { createMemoryInheritance } from "@/modules/workspace-kit/lib/memoryInheritance";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let scopes: MemoryConversation[];
let policy: "manual" | "always" | "never";
let trust: string | null;
let live: boolean;
const key = "a".repeat(64);
const digest = "b".repeat(64);
function packet() {
  return {
    schema: 1,
    decision: {
      schema: 1,
      policy,
      contextAllowed: policy === "always",
      captureAllowed: false,
      reason:
        policy === "always"
          ? "KIT_MEMORY_READY"
          : "KIT_MEMORY_CONSENT_REQUIRED",
    },
    packet:
      policy === "always"
        ? {
            schema: 1,
            projectKey: key,
            instructionDigest: digest,
            digest: "c".repeat(64),
            text: "facts",
            bytes: 5,
            contentState: "available",
          }
        : null,
  };
}
function fixture(supported = true) {
  const manager = createMemoryConversations(() => ({
    capture: (check: () => void) => check,
  }));
  const owner = {};
  const scope = manager.capture(
    owner,
    "/project",
    "/project",
    () => live,
    supported,
  );
  scopes.push(scope);
  return { scope, inheritance: createMemoryInheritance(scope), manager, owner };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  scopes = [];
  policy = "always";
  trust = digest;
  live = true;
  let next = 0;
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open")
      return { id: ++next, token: "panel" };
    if (command === "project_memory_select") return "selected";
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: "/canonical/project",
        blockedCount: 0,
        scope: { schema: 1, state: "ready", ancestryComplete: true },
      };
    if (command === "project_memory_review_policy")
      return {
        schema: 1,
        root: "/canonical/project",
        projectKey: key,
        policy: "always",
        preference: { projectKey: key, policy, instructionDigest: trust },
        revision: args.request.revision,
        review: "00000000-0000-4000-8000-000000000001",
      };
    if (command === "project_memory_review_trust")
      return {
        ...trustReply(args.request.revision),
        preference: { projectKey: key, policy, instructionDigest: trust },
      };
    if (command === "project_memory_context_open")
      return { id: ++next, token: "00000000-0000-4000-8000-000000000001" };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: "/canonical/project" };
    if (command === "project_memory_context_read") return packet();
  });
});
afterEach(async () => {
  await Promise.all(scopes.map((scope) => scope.close()));
});

it("does no IO until launch preparation and excludes unsupported channels", async () => {
  fixture();
  const f = fixture(false);
  expect(invoke).not.toHaveBeenCalled();
  await f.inheritance.prepare(() => {});
  expect(invoke).not.toHaveBeenCalled();
});

it.each(["manual", "never"] as const)(
  "does not read instructions or bind under %s and checks once per conversation",
  async (choice) => {
    policy = choice;
    const f = fixture();
    await f.inheritance.prepare(() => {});
    const calls = invoke.mock.calls.length;
    await f.inheritance.prepare(() => {});
    expect(invoke.mock.calls).toHaveLength(calls);
    expect(f.scope.status()).toBe("inactive");
    expect(
      invoke.mock.calls.some(
        ([command]) =>
          command === "project_memory_review_trust" ||
          command === "project_memory_context_open",
      ),
    ).toBe(false);
  },
);

it("inherits trusted Always without persisting session consent, policy or trust", async () => {
  const f = fixture();
  const first = f.inheritance.prepare(() => {});
  expect(f.inheritance.prepare(() => {})).toBe(first);
  await first;
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(true);
  expect(f.scope.status()).toBe("ready");
  expect(f.manager.turnSource(f.owner, () => {})).toBeDefined();
  expect(
    invoke.mock.calls.find(
      ([command]) => command === "project_memory_context_bind",
    )?.[1].request.mode,
  ).toBe("inherit");
  expect(
    invoke.mock.calls.some(([command]) => /confirm|initialize/.test(command)),
  ).toBe(false);
});

it.each([null, "d".repeat(64)])(
  "refuses unaccepted or changed instructions: %s",
  async (value) => {
    trust = value;
    const f = fixture();
    await expect(f.inheritance.prepare(() => {})).rejects.toMatchObject({
      code: "KIT_MEMORY_TRUST_REQUIRED",
    });
    expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "project_memory_context_bind",
      ),
    ).toBe(false);
  },
);

it.each(["absent", "reserved"])(
  "preserves a checked %s scope without reading private policy or instructions",
  async (state) => {
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) =>
      command === "project_memory_discover"
        ? Promise.resolve({
            schema: 1,
            root: null,
            blockedCount: 0,
            scope: { schema: 1, state, ancestryComplete: true },
          })
        : original?.(command, args),
    );
    const f = fixture();
    await f.inheritance.prepare(() => {});
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "project_memory_review_policy",
      ),
    ).toBe(false);
  },
);

it.each(["missingState", "denied", "invalidState", "timeout"])(
  "distinguishes missing policy from access failures: %s",
  async (code) => {
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) =>
      command === "project_memory_review_policy"
        ? Promise.reject({ code })
        : original?.(command, args),
    );
    const f = fixture();
    const result = f.inheritance.prepare(() => {});
    if (code === "missingState") await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toMatchObject({ code });
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "project_memory_review_trust",
      ),
    ).toBe(false);
  },
);

it("does not bind a retired request after a late instruction review", async () => {
  const review = deferred<unknown>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_review_trust") {
      started.resolve();
      return review.promise;
    }
    return original?.(command, args);
  });
  let active = true;
  const f = fixture();
  const pending = f.inheritance.prepare(() => {
    if (!active) throw new Error("request retired");
  });
  const observed = pending.catch((error: unknown) => error);
  await started.promise;
  active = false;
  review.resolve({
    ...trustReply(),
    preference: { projectKey: key, policy, instructionDigest: trust },
  });
  expect(await observed).toMatchObject({ message: "request retired" });
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_bind",
    ),
  ).toBe(false);
});

it("preserves explicit disable while an inherited native read is pending", async () => {
  const read = deferred<unknown>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      started.resolve();
      return read.promise;
    }
    return original?.(command, args);
  });
  const f = fixture();
  const pending = f.inheritance
    .prepare(() => {})
    .catch((error: unknown) => error);
  await started.promise;
  f.scope.delivery?.disable(() => true);
  read.resolve(packet());
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(f.scope.status()).toBe("ready");
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
  await f.inheritance.prepare(() => {});
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(false);
});

it("retains retired preparations against the shared budget until their reads and cleanup settle", async () => {
  const held = deferred<unknown>();
  const admitted = deferred<void>();
  const original = invoke.getMockImplementation();
  let policies = 0;
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_review_policy") {
      if (++policies === 256) admitted.resolve();
      return held.promise;
    }
    return original?.(command, args);
  });
  const fixtures = Array.from({ length: 256 }, () => fixture());
  const pending = fixtures.map((f) =>
    f.inheritance.prepare(() => {}).catch((error: unknown) => error),
  );
  await admitted.promise;
  await Promise.all(fixtures.map((f) => f.scope.close()));
  const replacement = fixture();
  await expect(replacement.inheritance.prepare(() => {})).rejects.toMatchObject(
    { code: "busy" },
  );
  held.resolve({
    schema: 1,
    root: "/canonical/project",
    projectKey: key,
    policy: "always",
    preference: { projectKey: key, policy, instructionDigest: trust },
    revision: 1,
    review: "00000000-0000-4000-8000-000000000001",
  });
  expect(
    (await Promise.all(pending)).every(
      (result) =>
        result &&
        typeof result === "object" &&
        "code" in result &&
        result.code === "cancelled",
    ),
  ).toBe(true);
  if (!original) throw new Error("Missing native fixture");
  invoke.mockImplementation(original);
  await replacement.inheritance.prepare(() => {});
  expect(replacement.scope.delivery?.getSnapshot().enabled).toBe(true);
});
