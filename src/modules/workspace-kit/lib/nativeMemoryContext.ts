import { invoke } from "@tauri-apps/api/core";
import type {
  MemoryContextPacket,
  MemoryContextResult,
} from "@/modules/workspace-kit/lib/context";
import type { MemoryTransport } from "@/modules/workspace-kit/lib/memoryTransport";

type Handle = Readonly<{ id: number; token: string }>;
const brand = Symbol("native-memory-context");
export type NativeMemoryContext = Readonly<{
  [brand]: true;
  read: () => Promise<MemoryContextResult>;
  close: () => Promise<void>;
}>;
type Binding = (
  issue: (handle: Handle, check: () => void) => Promise<unknown>,
  acquireTransport?: () => MemoryTransport,
) => Promise<Readonly<{ check: () => void; root: string }>>;
const bindings = new WeakMap<NativeMemoryContext, Binding>();
let resources = 0;
let reads = 0;

function fail(code: "cancelled" | "unavailable" | "busy"): never {
  throw Object.assign(new Error(`Memory context ${code}`), { code });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("unavailable");
  return value as Record<string, unknown>;
}
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function packet(value: unknown): MemoryContextPacket {
  const data = record(value);
  if (
    data.schema !== 1 ||
    !digest(data.projectKey) ||
    !digest(data.instructionDigest) ||
    !digest(data.digest) ||
    typeof data.contentState !== "string" ||
    !["initial", "available", "unknown"].includes(data.contentState) ||
    typeof data.text !== "string" ||
    data.text.length > 24 * 1024 ||
    data.text.includes("\0") ||
    !Number.isSafeInteger(data.bytes) ||
    (data.bytes as number) > 24 * 1024 ||
    new TextEncoder().encode(data.text).length !== data.bytes
  )
    fail("unavailable");
  for (const scalar of data.text) {
    const point = scalar.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) fail("unavailable");
  }
  return Object.freeze({
    schema: 1,
    projectKey: data.projectKey,
    instructionDigest: data.instructionDigest,
    digest: data.digest,
    bytes: data.bytes,
    contentState: data.contentState,
    text: data.text,
  }) as MemoryContextPacket;
}

function result(value: unknown): MemoryContextResult {
  const data = record(value);
  const decision = record(data.decision);
  if (
    data.schema !== 1 ||
    decision.schema !== 1 ||
    decision.policy !== "manual" ||
    decision.reason !== "KIT_MEMORY_READY" ||
    decision.captureAllowed !== false ||
    decision.contextAllowed !== true
  )
    fail("unavailable");
  return Object.freeze({
    schema: 1,
    decision: Object.freeze({
      schema: 1,
      policy: decision.policy,
      contextAllowed: decision.contextAllowed,
      captureAllowed: false,
      reason: decision.reason,
    }),
    packet: packet(data.packet),
  }) as MemoryContextResult;
}

export function bindNativeProjectMemoryContext(
  context: NativeMemoryContext,
  issue: (handle: Handle, check: () => void) => Promise<unknown>,
  acquireTransport?: () => MemoryTransport,
): Promise<Readonly<{ check: () => void; root: string }>> {
  const bind = bindings.get(context);
  return bind
    ? bind(issue, acquireTransport)
    : Promise.reject({ code: "cancelled" });
}

export function createNativeMemoryContext(
  isOwnerCurrent: () => boolean,
): NativeMemoryContext {
  let retired = false;
  let phase: "empty" | "binding" | "ready" = "empty";
  let opening: Promise<void> | null = null;
  let handle: Handle | null = null;
  let closing: Promise<void> | null = null;
  let reading: Promise<MemoryContextResult> | null = null;
  let reserved = false;
  let binding = false;
  let acknowledged = false;
  let transport: MemoryTransport | undefined;
  const request = <T>(command: string, args?: Record<string, unknown>) =>
    transport ? transport.invoke<T>(command, args) : invoke<T>(command, args);
  let expectedPacket: Readonly<{
    projectKey: string;
  }> | null = null;
  function check() {
    if (retired || isOwnerCurrent() !== true || retired) {
      retired = true;
      fail("cancelled");
    }
    transport?.check();
  }
  function release() {
    if (reserved && acknowledged && !binding && !reading) {
      reserved = false;
      resources -= 1;
    }
  }
  function close(): Promise<void> {
    retired = true;
    if (closing) return closing;
    closing = Promise.resolve()
      .then(async () => {
        try {
          await opening;
        } catch {
          // A rejected open returned no addressable resource.
        }
        if (handle) {
          try {
            await request("project_memory_context_close", { handle });
          } catch (error) {
            if (
              !error ||
              typeof error !== "object" ||
              !("code" in error) ||
              error.code !== "cancelled"
            )
              throw error;
          }
          handle = null;
        }
        await transport?.release();
        acknowledged = true;
        release();
      })
      .catch((error: unknown) => {
        closing = null;
        throw error;
      });
    return closing;
  }
  const context: NativeMemoryContext = Object.freeze({
    [brand]: true as const,
    read() {
      try {
        check();
        if (phase !== "ready" || !handle) fail("cancelled");
        if (reading) return reading;
        if (reads >= 256) fail("busy");
        reads += 1;
        const captured = handle;
        reading = Promise.resolve().then(async () => {
          try {
            check();
            const reply = await request("project_memory_context_read", {
              handle: captured,
            });
            check();
            const value = result(reply);
            if (
              !value.packet ||
              value.packet.projectKey !== expectedPacket?.projectKey ||
              value.decision.policy !== "manual"
            )
              fail("unavailable");
            return value;
          } catch (error) {
            check();
            throw error;
          } finally {
            reads -= 1;
            reading = null;
            release();
          }
        });
        return reading;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    close,
  });
  bindings.set(context, async (issue, acquireTransport) => {
    check();
    if (phase !== "empty") fail("cancelled");
    if (resources >= 256) fail("busy");
    resources += 1;
    reserved = true;
    phase = "binding";
    binding = true;
    opening = Promise.resolve().then(async () => {
      check();
      transport = acquireTransport?.();
      check();
      const reply = record(await request("project_memory_context_open"));
      if (
        !Number.isSafeInteger(reply.id) ||
        (reply.id as number) < 0 ||
        (reply.id as number) > 0xffffffff ||
        typeof reply.token !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          reply.token,
        )
      )
        fail("unavailable");
      handle = Object.freeze({ id: reply.id as number, token: reply.token });
    });
    try {
      await opening;
      check();
      if (!handle) fail("unavailable");
      const reply = record(await issue(handle, check));
      check();
      if (
        reply.schema !== 2 ||
        typeof reply.root !== "string" ||
        !reply.root ||
        reply.root.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(reply.root) ||
        new TextEncoder().encode(reply.root).length > 4096
      )
        fail("unavailable");
      for (const scalar of reply.root) {
        const point = scalar.codePointAt(0) ?? 0;
        if (point >= 0xd800 && point <= 0xdfff) fail("unavailable");
      }
      const initial = packet(reply.packet);
      expectedPacket = Object.freeze({ projectKey: initial.projectKey });
      phase = "ready";
      return Object.freeze({ check, root: reply.root as string });
    } catch (error) {
      await close();
      throw error;
    } finally {
      binding = false;
      release();
    }
  });
  return context;
}
