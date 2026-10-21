import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HarnessId } from "@/modules/harness/lib/session";
import type { RemoteSshConnection } from "@/modules/remote/client";
import {
  parseRemotePath,
  relativeWithinProject,
  remoteProjectForPath,
} from "@/modules/connections/model/remoteProjects";
import {
  findSshProfile,
  remoteSshConnectionFor,
  remoteSshConnectionForProfile,
  remoteSshConnectionIdForEnvironment,
} from "@/modules/connections/model/remoteSshProfiles";
import { probeRemoteAgent } from "@/modules/remote/agentProbe";
import {
  openHeldRemoteSession,
  releaseHeldRemoteSession,
} from "@/modules/remote/sessionManager";
import { isRemoteSessionAdmissionError } from "@/modules/remote/sessionPool";
import { checkRemoteAgentProbe } from "./remoteAgents";
import { remoteMachineFor } from "@/modules/connections/model/connections";
import { usePreferencesStore } from "@/modules/settings/preferences";

export interface ChildBackend {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<UnlistenFn>;
}

let backend: ChildBackend | undefined;

export function configureChildBackend(next: ChildBackend): void {
  if (backend || bridge || users)
    throw new Error(
      "Configure the child backend once before starting the bridge",
    );
  backend = next;
}

function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return backend
    ? backend.invoke<T>(command, args)
    : tauriInvoke<T>(command, args);
}

function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return backend ? backend.listen(event, handler) : tauriListen(event, handler);
}

type LinePayload = { sessionId: string; line: string };
type ExitPayload = { sessionId: string; code: number | null; pid?: number };
type SsePayload = { sessionId: string; data: string };
type SseEndPayload = { sessionId: string; error?: string | null };

type LineHandler = (line: string) => void;
type ExitHandler = (code: number | null) => void;
type SseHandler = (data: string) => void;
type SseEndHandler = (error?: string) => void;

const lineHandlers = new Map<string, LineHandler>();
const exitHandlers = new Map<string, ExitHandler>();
const lineBuffer = new Map<string, string[]>();
const stderrHandlers = new Map<string, LineHandler>();
const sseHandlers = new Map<string, SseHandler>();
const sseEndHandlers = new Map<string, SseEndHandler>();
const sseBuffer = new Map<string, string[]>();
// Output is broadcast to every window. Only ids this window spawned or opened
// may buffer while unwatched; anything else would be held until the bridge
// is torn down, since nothing here ever watches or unwatches it.
const ownedChildren = new Set<string>();
const ownedSse = new Set<string>();
type SseTransport = {
  sessionId: string;
  nativeId: string;
  opening: Promise<void>;
  closing?: Promise<void>;
};
const sseTransports = new Map<string, SseTransport>();
const sseNativeOwners = new Map<string, SseTransport>();
const sseResources = new Set<SseTransport>();
const MAX_SSE_RESOURCES = 256;

function retireSse(transport: SseTransport): Promise<void> {
  if (sseTransports.get(transport.sessionId) === transport) {
    sseTransports.delete(transport.sessionId);
    ownedSse.delete(transport.sessionId);
  }
  sseNativeOwners.delete(transport.nativeId);
  if (!transport.closing) {
    transport.closing = transport.opening
      .catch(() => undefined)
      .then(() =>
        invoke<void>("harness_sse_close", { sessionId: transport.nativeId }),
      )
      .then(() => {
        sseResources.delete(transport);
      });
    void transport.closing.catch(() => undefined);
  }
  return transport.closing;
}
const livePid = new Map<string, number>();
/** Helper session kept open for each running remote agent. */
const remoteHolds = new Map<string, number>();

function releaseRemoteHold(sessionId: string) {
  const held = remoteHolds.get(sessionId);
  if (held === undefined) return;
  remoteHolds.delete(sessionId);
  void releaseHeldRemoteSession("agent", held).catch(() => undefined);
}
const pendingExit = new Map<
  string,
  Array<{ code: number | null; pid: number }>
>();

/** True when this exit belongs to the child we currently have spawned. */
export function isCurrentChildExit(
  expectedPid: number | undefined,
  exitedPid: number | undefined,
): boolean {
  if (expectedPid == null || expectedPid <= 0) return false;
  if (exitedPid == null || exitedPid <= 0) return false;
  return exitedPid === expectedPid;
}

const MAX_BUFFERED = 1000;
let bridge: Promise<UnlistenFn[]> | null = null;
let bridgeAttempt: symbol | null = null;
let users = 0;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;

function pushBounded(
  map: Map<string, string[]>,
  sessionId: string,
  item: string,
) {
  const queued = map.get(sessionId) ?? [];
  queued.push(item);
  if (queued.length > MAX_BUFFERED) {
    queued.splice(0, queued.length - MAX_BUFFERED);
  }
  map.set(sessionId, queued);
}

function ensureBridge() {
  if (bridge) return;
  let failed = false;
  const installed: UnlistenFn[] = [];
  const register = (pending: Promise<UnlistenFn>) =>
    pending.then((unlisten) => {
      if (failed) {
        unlisten();
        return () => undefined;
      }
      installed.push(unlisten);
      return unlisten;
    });
  const attempt = Symbol("bridge-installation");
  bridgeAttempt = attempt;
  const installation = Promise.all([
    register(
      listen<LinePayload>("harness-stdout", (event) => {
        if (bridgeAttempt !== attempt) return;
        const { sessionId, line } = event.payload;
        const handler = lineHandlers.get(sessionId);
        if (handler) {
          handler(line);
          return;
        }
        if (ownedChildren.has(sessionId)) {
          pushBounded(lineBuffer, sessionId, line);
        }
      }),
    ),
    register(
      listen<LinePayload>("harness-stderr", (event) => {
        if (bridgeAttempt !== attempt) return;
        const { sessionId, line } = event.payload;
        stderrHandlers.get(sessionId)?.(line);
      }),
    ),
    register(
      listen<ExitPayload>("harness-exit", (event) => {
        if (bridgeAttempt !== attempt) return;
        const { sessionId, code, pid } = event.payload;
        const handler = exitHandlers.get(sessionId);
        if (!handler || pid == null || pid <= 0) return;
        const currentPid = livePid.get(sessionId);
        if (isCurrentChildExit(currentPid, pid)) {
          livePid.delete(sessionId);
          releaseRemoteHold(sessionId);
          handler(code);
          return;
        }
        if (currentPid != null) return;
        const exits = pendingExit.get(sessionId) ?? [];
        exits.push({ code, pid });
        if (exits.length > 8) exits.splice(0, exits.length - 8);
        pendingExit.set(sessionId, exits);
      }),
    ),
    register(
      listen<SsePayload>("harness-sse", (event) => {
        if (bridgeAttempt !== attempt) return;
        const transport = sseNativeOwners.get(event.payload.sessionId);
        if (!transport || sseTransports.get(transport.sessionId) !== transport)
          return;
        const sessionId = transport.sessionId;
        const data = event.payload.data;
        const handler = sseHandlers.get(sessionId);
        if (handler) {
          handler(data);
          return;
        }
        if (ownedSse.has(sessionId)) pushBounded(sseBuffer, sessionId, data);
      }),
    ),
    register(
      listen<SseEndPayload>("harness-sse-end", (event) => {
        if (bridgeAttempt !== attempt) return;
        const transport = sseNativeOwners.get(event.payload.sessionId);
        if (!transport || sseTransports.get(transport.sessionId) !== transport)
          return;
        sseEndHandlers.get(transport.sessionId)?.(
          event.payload.error ?? undefined,
        );
      }),
    ),
  ]).catch((error: unknown) => {
    failed = true;
    installed.splice(0).forEach((unlisten) => unlisten());
    if (bridgeAttempt === attempt) {
      bridge = null;
      bridgeAttempt = null;
    }
    throw error;
  });
  void installation.catch(() => undefined);
  bridge = installation;
}

function teardownBridge() {
  const pending = bridge;
  bridge = null;
  bridgeAttempt = null;
  lineHandlers.clear();
  exitHandlers.clear();
  lineBuffer.clear();
  stderrHandlers.clear();
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedChildren.clear();
  ownedSse.clear();
  livePid.clear();
  for (const sessionId of [...remoteHolds.keys()]) releaseRemoteHold(sessionId);
  pendingExit.clear();
  void pending?.then((fns) => fns.forEach((fn) => fn())).catch(() => undefined);
}

export function startHarnessBridge(): () => void {
  users += 1;
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = undefined;
  }
  ensureBridge();
  return () => {
    users -= 1;
    if (users > 0) return;
    users = 0;
    teardownTimer = setTimeout(() => {
      teardownTimer = undefined;
      if (users === 0) teardownBridge();
    }, 0);
  };
}

export async function acquireHarnessBridge(): Promise<() => void> {
  const release = startHarnessBridge();
  const installation = bridge;
  try {
    await installation;
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    users = 0;
    if (teardownTimer) {
      clearTimeout(teardownTimer);
      teardownTimer = undefined;
    }
    teardownBridge();
  });
}

export function watchChild(
  sessionId: string,
  onLine: LineHandler,
  onExit: ExitHandler,
  onStderr?: LineHandler,
) {
  const queued = lineBuffer.get(sessionId);
  lineBuffer.delete(sessionId);
  lineHandlers.set(sessionId, onLine);
  exitHandlers.set(sessionId, onExit);
  if (onStderr) stderrHandlers.set(sessionId, onStderr);
  if (queued) queued.forEach(onLine);
}

export function unwatchChild(sessionId: string) {
  lineHandlers.delete(sessionId);
  exitHandlers.delete(sessionId);
  lineBuffer.delete(sessionId);
  ownedChildren.delete(sessionId);
  stderrHandlers.delete(sessionId);
  pendingExit.delete(sessionId);
}

export function watchSse(
  sessionId: string,
  onData: SseHandler,
  onEnd?: SseEndHandler,
) {
  if (!sseHandlers.has(sessionId) && sseHandlers.size >= MAX_SSE_RESOURCES)
    throw new Error("HARNESS_SSE_CAPACITY");
  if (sseHandlers.has(sessionId)) unwatchSse(sessionId);
  const queued = sseBuffer.get(sessionId);
  sseBuffer.delete(sessionId);
  sseHandlers.set(sessionId, onData);
  if (onEnd) sseEndHandlers.set(sessionId, onEnd);
  else sseEndHandlers.delete(sessionId);
  for (const data of queued ?? []) {
    if (sseHandlers.get(sessionId) !== onData) break;
    onData(data);
  }
}

export function unwatchSse(sessionId: string) {
  const transport = sseTransports.get(sessionId);
  if (transport) void retireSse(transport);
  sseHandlers.delete(sessionId);
  sseEndHandlers.delete(sessionId);
  sseBuffer.delete(sessionId);
  ownedSse.delete(sessionId);
}

export function cleanRemoteCommand(command: string): string {
  const base = command.split(/[/\\]/).pop() || command;
  return base.replace(/\.(cmd|exe|bat|sh)$/i, "");
}

export async function resolveRemoteSshConnection(
  environmentId: string,
): Promise<RemoteSshConnection> {
  const saved = usePreferencesStore.getState().sshConnections ?? [];
  const profile = findSshProfile(environmentId, saved);
  if (profile) return remoteSshConnectionForProfile(profile);
  const machine = await remoteMachineFor(environmentId);
  if (machine) return remoteSshConnectionFor(machine, saved);
  throw new Error(
    `The saved SSH connection for remote environment "${environmentId}" is missing.`,
  );
}

/** Keeps the project's helper session open while a remote agent runs, so the
 * agent starts without a second login. Unavailable helpers may use native
 * fallback; admission barriers must not start an independent connection. */
async function holdRemoteProjectSession(
  environmentId: string,
  connection: RemoteSshConnection,
  cwd: string,
): Promise<{
  sessionId: number;
  root: string;
  capabilities: string[];
} | null> {
  const profileId = remoteSshConnectionIdForEnvironment(environmentId);
  const project = remoteProjectForPath(cwd);
  if (!profileId || !project) return null;
  try {
    const session = await openHeldRemoteSession(
      "agent",
      profileId,
      connection,
      project.cwd,
    );
    return {
      sessionId: session.session_id,
      root: session.workspace_root,
      capabilities: session.capabilities,
    };
  } catch (reason) {
    if (isRemoteSessionAdmissionError(reason)) throw reason;
    return null;
  }
}

export async function spawnChild(
  sessionId: string,
  command: string,
  args: string[],
  cwd: string,
  networkAllowlist?: string[] | null,
  account?: { provider: "claude" | "codex"; id: string },
  logicalSessionId?: string,
): Promise<void> {
  livePid.delete(sessionId);
  pendingExit.delete(sessionId);
  ownedChildren.add(sessionId);

  let remoteConnection: RemoteSshConnection | null = null;
  let remoteCwd: string | null = null;
  let remoteSessionId: number | null = null;
  let remoteRoot: string | null = null;
  let remoteRelativeCwd: string | null = null;
  let execCommand = command;

  const remote = parseRemotePath(cwd);
  if (remote) {
    remoteConnection = await resolveRemoteSshConnection(remote.environmentId);
    remoteCwd = remote.hostPath;
    execCommand = cleanRemoteCommand(command);
    // The helper confines the agent to the project root, so only a saved
    // project may host one.
    const project = remoteProjectForPath(cwd);
    if (!project) {
      throw new Error("This path is outside a saved remote project.");
    }
    // The helper resolves folders below its canonical root, so the agent folder
    // is sent relative to the project instead of as the path typed by the user.
    remoteRelativeCwd =
      relativeWithinProject(project.cwd, remote.hostPath) ?? null;
    releaseRemoteHold(sessionId);
    const held = await holdRemoteProjectSession(
      remote.environmentId,
      remoteConnection,
      cwd,
    );
    if (held) {
      remoteHolds.set(sessionId, held.sessionId);
      remoteSessionId = held.sessionId;
      remoteRoot = held.root;
      if (held.capabilities.includes("agent.probe")) {
        const probe = await probeRemoteAgent(held.sessionId, execCommand).catch(
          () => undefined,
        );
        if (probe) {
          try {
            checkRemoteAgentProbe(execCommand, probe);
          } catch (error) {
            releaseRemoteHold(sessionId);
            throw error;
          }
        }
      }
    }
  }

  let pid: number;
  try {
    pid = await invoke<number>("harness_spawn", {
      sessionId,
      ...(logicalSessionId === undefined ? {} : { logicalSessionId }),
      command: execCommand,
      args,
      cwd,
      networkAllowlist: networkAllowlist ?? null,
      account,
      remoteConnection,
      remoteCwd,
      remoteSessionId,
      remoteRoot,
      remoteRelativeCwd,
    });
  } catch (error) {
    releaseRemoteHold(sessionId);
    throw error;
  }
  if (typeof pid !== "number" || pid <= 0) {
    releaseRemoteHold(sessionId);
    return;
  }
  livePid.set(sessionId, pid);
  const exits = pendingExit.get(sessionId);
  pendingExit.delete(sessionId);
  const exited = exits?.find((event) => event.pid === pid);
  if (!exited) return;
  livePid.delete(sessionId);
  exitHandlers.get(sessionId)?.(exited.code);
}

export function writeChild(sessionId: string, line: string): Promise<void> {
  return invoke("harness_write", { sessionId, line });
}

export function killChild(sessionId: string): Promise<void> {
  releaseRemoteHold(sessionId);
  livePid.delete(sessionId);
  pendingExit.delete(sessionId);
  unwatchChild(sessionId);
  return invoke("harness_kill", { sessionId });
}

export function killAllChildren(): Promise<void> {
  for (const transport of sseResources) void retireSse(transport);
  lineHandlers.clear();
  exitHandlers.clear();
  lineBuffer.clear();
  stderrHandlers.clear();
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedChildren.clear();
  ownedSse.clear();
  livePid.clear();
  pendingExit.clear();
  return invoke("harness_kill_all");
}

export function resolveCursorBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_cursor");
}

export function resolveCodexBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_codex");
}

export function resolveOpenCodeBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_opencode");
}

export function resolveClaudeBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_claude");
}

export function resolvePiBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_pi");
}

export function resolveOmpBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_omp");
}

export function resolveFxBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_fx");
}

export function resolveGrokBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_grok");
}

export function resolveGeminiBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_gemini");
}

export function resolveHermesBinary(): Promise<{ path: string }> {
  return invoke("harness_resolve_hermes");
}

export function freeHarnessPort(): Promise<number> {
  return invoke("harness_free_port");
}

export function harnessHttp(input: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{ status: number; body: string }> {
  return invoke("harness_http", input);
}

export function openHarnessSse(
  sessionId: string,
  url: string,
  headers?: Record<string, string>,
): Promise<void> {
  if (sseResources.size >= MAX_SSE_RESOURCES)
    return Promise.reject(new Error("HARNESS_SSE_CAPACITY"));
  const previous = sseTransports.get(sessionId);
  if (previous) void retireSse(previous);
  const nativeId = `harness-sse-${crypto.randomUUID()}`;
  const transport: SseTransport = {
    sessionId,
    nativeId,
    opening: Promise.resolve().then(() =>
      invoke<void>("harness_sse_open", { sessionId: nativeId, url, headers }),
    ),
  };
  sseTransports.set(sessionId, transport);
  sseNativeOwners.set(nativeId, transport);
  sseResources.add(transport);
  ownedSse.add(sessionId);
  return transport.opening.catch(async (error: unknown) => {
    if (sseTransports.get(sessionId) === transport) unwatchSse(sessionId);
    await retireSse(transport).catch(() => undefined);
    throw error;
  });
}

export function closeHarnessSse(
  sessionId: string,
  expectedHandler?: SseHandler,
): Promise<void> {
  if (expectedHandler && sseHandlers.get(sessionId) !== expectedHandler)
    return Promise.resolve();
  const transport = sseTransports.get(sessionId);
  unwatchSse(sessionId);
  return transport ? retireSse(transport) : Promise.resolve();
}

export function execChild(
  command: string,
  args: string[],
  cwd?: string,
  binaryProvider?: "grok" | "opencode",
): Promise<string> {
  return invoke("harness_exec", {
    command,
    args,
    cwd,
    ...(binaryProvider ? { binaryProvider } : {}),
  });
}

export async function resolveHarnessBinary(
  provider: HarnessId,
): Promise<{ path: string }> {
  switch (provider) {
    case "claude":
      return resolveClaudeBinary();
    case "codex":
      return resolveCodexBinary();
    case "cursor":
      return resolveCursorBinary();
    case "opencode":
      return resolveOpenCodeBinary();
    case "pi":
      return resolvePiBinary();
    case "omp":
      return resolveOmpBinary();
    case "fx":
      return resolveFxBinary();
    case "grok":
      return resolveGrokBinary();
    case "hermes":
      return resolveHermesBinary();
    case "gemini":
      return resolveGeminiBinary();
    default:
      throw new Error(`Unsupported harness provider: ${provider}`);
  }
}

export type HarnessBinaryInspection = {
  path: string;
  version?: string;
  error?: string;
};

export function inspectHarnessBinary(
  provider: HarnessId,
): Promise<HarnessBinaryInspection> {
  return resolveHarnessBinary(provider).then(async (resolved) => {
    try {
      const version = (await execChild(resolved.path, ["--version"])).trim();
      return /\d+\.\d+\.\d+/.test(version)
        ? { path: resolved.path, version }
        : { path: resolved.path, error: "CLI returned no valid version." };
    } catch (error) {
      return {
        path: resolved.path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** Runs the CLI's own self-update against the binary Voktty uses. */
export async function updateHarnessCli(provider: HarnessId): Promise<void> {
  const resolved = await resolveHarnessBinary(provider);
  await invoke("harness_update", {
    command: resolved.path,
    binaryProvider: provider,
  });
}
