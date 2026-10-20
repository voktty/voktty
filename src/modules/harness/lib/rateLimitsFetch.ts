import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "./fs";
import {
  errorRateLimits,
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  parseOpencodeGoUsage,
  RATE_LIMIT_FETCH_DEADLINE_MS,
  unavailableRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "./rateLimits";
import { recordUsageAttempt } from "./usageDiagnostics";
import {
  killChild,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./harness/child";
import { asRecord } from "./harness/codexProtocol";
import { JsonRpcClient } from "./harness/jsonRpc";

const USAGE_CHILD_PREFIX = "voktty-codex-usage";
const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Runs one provider read with a hard deadline and records how it went. A read
 * that hangs ends as an error instead of leaving the footer on "loading".
 */
export async function observeUsageFetch(
  provider: RateLimitProvider,
  accountId: string,
  run: () => Promise<ProviderRateLimits>,
  deadlineMs = RATE_LIMIT_FETCH_DEADLINE_MS,
): Promise<ProviderRateLimits> {
  const startedAt = Date.now();
  let result: ProviderRateLimits;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${provider} usage did not answer within ${Math.round(deadlineMs / 1000)}s`,
              ),
            ),
          deadlineMs,
        );
      }),
    ]);
  } catch (error) {
    result = errorRateLimits(
      provider,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  recordUsageAttempt({
    provider,
    accountId,
    startedAt,
    durationMs: Date.now() - startedAt,
    status: result.status,
    error: result.error,
  });
  return result;
}

type OpencodeGoUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

/**
 * Fetch OpenCode Go 5h / weekly / monthly usage via the official API.
 * Runs through a Tauri command so the webview CORS policy does not apply.
 */
export function fetchOpencodeGoRateLimits(): Promise<ProviderRateLimits> {
  return observeUsageFetch("opencode", "default", readOpencodeGoRateLimits);
}

async function readOpencodeGoRateLimits(): Promise<ProviderRateLimits> {
  let result: OpencodeGoUsageFetch;
  try {
    result = await invoke<OpencodeGoUsageFetch>("fetch_opencode_go_usage");
  } catch (error) {
    return errorRateLimits(
      "opencode",
      error instanceof Error
        ? error.message
        : "OpenCode Go usage unavailable",
    );
  }
  if (result.status === "ok" && result.body) {
    try {
      const parsed = parseOpencodeGoUsage(JSON.parse(result.body));
      if (parsed.session || parsed.weekly || parsed.monthly) return parsed;
    } catch {
      return errorRateLimits("opencode", "OpenCode Go response was not JSON");
    }
    // A 200 with no usable windows is malformed: report an error so the
    // footer retries instead of sticking in "unavailable" forever.
    return errorRateLimits(
      "opencode",
      "OpenCode Go usage response was unexpected",
    );
  }
  if (result.status === "unavailable") {
    return unavailableRateLimits(
      "opencode",
      result.error?.trim() || "OpenCode Go not connected",
    );
  }
  return errorRateLimits(
    "opencode",
    result.error?.trim() || "OpenCode Go usage unavailable",
  );
}

export type CodexRateLimitResetOutcome =
  | "reset"
  | "nothingToReset"
  | "noCredit"
  | "alreadyRedeemed";

type ClaudeUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

export function fetchClaudeRateLimits(
  accountId = "default",
): Promise<ProviderRateLimits> {
  return observeUsageFetch("claude", accountId, () =>
    readClaudeRateLimits(accountId),
  );
}

async function readClaudeRateLimits(
  accountId: string,
): Promise<ProviderRateLimits> {
  try {
    const result = await invoke<ClaudeUsageFetch>("fetch_claude_usage", {
      accountId,
    });
    if (result.status === "ok" && result.body) {
      const parsed = parseClaudeOAuthUsage(result.body);
      if (parsed.session || parsed.weekly) return parsed;
      return {
        ...parsed,
        status: parsed.status === "ok" ? "ok" : parsed.status,
      };
    }
    if (result.status === "unavailable") {
      return unavailableRateLimits(
        "claude",
        result.error?.trim() || "Claude not signed in",
      );
    }
    return errorRateLimits(
      "claude",
      result.error?.trim() || "Claude usage unavailable",
    );
  } catch (error) {
    return errorRateLimits(
      "claude",
      error instanceof Error ? error.message : "Claude usage unavailable",
    );
  }
}

export function fetchCodexRateLimits(
  accountId = "default",
): Promise<ProviderRateLimits> {
  return observeUsageFetch("codex", accountId, () =>
    readCodexRateLimits(accountId),
  );
}

async function readCodexRateLimits(
  accountId: string,
): Promise<ProviderRateLimits> {
  let path: string;
  try {
    path = (await resolveCodexBinary()).path;
  } catch {
    return unavailableRateLimits("codex", "Codex CLI not found");
  }

  const cwd = await homeDir();
  try {
    const result = await requestCodexAccount<unknown>(
      path,
      cwd,
      "account/rateLimits/read",
      {},
      accountId,
    );
    const parsed = parseCodexRateLimits(result);
    if (
      parsed.session ||
      parsed.weekly ||
      parsed.monthly ||
      parsed.resetCredits
    ) {
      return parsed;
    }
    const rec = asRecord(result);
    if (rec) {
      return unavailableRateLimits("codex", "No Codex usage data");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not signed in|chatgpt authentication required|not authenticated/i.test(
        message,
      )
    ) {
      return unavailableRateLimits("codex", "Codex not signed in");
    }
    if (/ENOENT|not found|could not run/i.test(message)) {
      return unavailableRateLimits("codex", "Codex CLI not found");
    }
    return errorRateLimits("codex", message);
  }
}

export async function consumeCodexRateLimitResetCredit(
  creditId?: string,
  accountId = "default",
): Promise<CodexRateLimitResetOutcome> {
  const path = (await resolveCodexBinary()).path;
  const cwd = await homeDir();
  const result = await requestCodexAccount<unknown>(
    path,
    cwd,
    "account/rateLimitResetCredit/consume",
    {
      idempotencyKey: crypto.randomUUID(),
      ...(creditId ? { creditId } : {}),
    },
    accountId,
  );
  const outcome = asRecord(result)?.outcome;
  if (
    outcome === "reset" ||
    outcome === "nothingToReset" ||
    outcome === "noCredit" ||
    outcome === "alreadyRedeemed"
  ) {
    return outcome;
  }
  throw new Error("Codex returned an unknown reset result");
}

async function requestCodexAccount<T>(
  path: string,
  cwd: string,
  method: string,
  params: unknown,
  accountId: string,
): Promise<T> {
  // One id per probe: two windows, or a probe racing the previous one, must
  // never kill each other's process.
  const childId = `${USAGE_CHILD_PREFIX}-${crypto.randomUUID().slice(0, 8)}`;
  let stage = "starting Codex";
  const rpc = new JsonRpcClient(
    childId,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: "codex-usage" },
  );

  const stop = async () => {
    rpc.close();
    unwatchChild(childId);
    await killChild(childId).catch(() => undefined);
  };

  watchChild(
    childId,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex usage probe exited")),
  );

  try {
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        await spawnChild(childId, path, ["app-server"], cwd, null, {
          provider: "codex",
          id: accountId,
        });
        stage = "initializing Codex";
        await rpc.request(
          "initialize",
          {
            clientInfo: {
              name: "voktty",
              title: "Voktty",
              version: "1.0.12",
            },
            capabilities: { experimentalApi: true },
          },
          REQUEST_TIMEOUT_MS,
        );
        await rpc.notify("initialized", undefined);
        stage = "reading usage";
        return rpc.request<T>(method, params, REQUEST_TIMEOUT_MS);
      },
      () => {
        void stop();
      },
      () => stage,
    );
  } finally {
    await stop();
  }
}
async function withTimeout<T>(
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => void,
  describeStage: () => string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = work();
  try {
    return await Promise.race([
      pending,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(`Codex usage probe timed out while ${describeStage()}`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void pending.catch(() => undefined);
  }
}
