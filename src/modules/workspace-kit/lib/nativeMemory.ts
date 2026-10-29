import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace/env";
import type { MemoryScope } from "@/modules/workspace-kit/lib/scope";
import type { KitDeploymentEntry } from "@/modules/workspace-kit/lib/deployment";
import type { KitLock } from "@/modules/workspace-kit/lib/configTypes";

type Handle = Readonly<{ id: number; token: string }>;
const selectionBrand = Symbol("native-memory-selection");
export type NativeMemorySelection = Readonly<{
  [selectionBrand]: true;
}>;
export type NativeMemoryScope = Readonly<{
  schema: 1;
  scope: MemoryScope;
  root: string | null;
  blockedCount: number;
}>;
const reviewBrand = Symbol("native-memory-review");
export type NativeMemoryPreviewInput = Readonly<{
  destination: string;
  environment: WorkspaceEnv;
  inputs: Readonly<Record<string, string>>;
  links: Readonly<{ agents: boolean; claude: boolean }>;
}>;
export type NativeMemoryPreviewSnapshot = Readonly<{
  schema: 1;
  deployment: Readonly<{
    entries: readonly KitDeploymentEntry[];
    canPublish: boolean;
    lock: KitLock | null;
  }>;
  isResuming: boolean;
  recoveryFiles: readonly Readonly<{ path: string; text: string }>[];
  publicationBlocker: string | null;
}>;
export type NativeMemoryReview = Readonly<{
  [reviewBrand]: true;
  snapshot: NativeMemoryPreviewSnapshot;
}>;
export type NativeMemoryPublication = Readonly<{
  schema: 1;
  created: readonly string[];
  skipped: readonly string[];
  migrated: readonly string[];
  cleaned: readonly string[];
}>;
export type NativeMemoryDeploymentError = Readonly<{
  code: string;
  changes?: Readonly<{
    created: readonly string[];
    migrated: readonly string[];
    cleaned: readonly string[];
    possibleRecoveryFiles: readonly string[];
  }>;
}>;
type PreviewReply = NativeMemoryPreviewSnapshot & {
  review: string;
  revision: number;
};
type Review = {
  selection: NativeMemorySelection;
  revision: number;
  receipt: NativeMemoryReview | null;
  token: string | null;
  phase: "opening" | "ready" | "publishing" | "consumed";
  confirmation: Promise<NativeMemoryPublication> | null;
  cancellation: Promise<boolean> | null;
};

function nativeEnvironment(environment: WorkspaceEnv) {
  const captured = structuredClone(environment);
  return captured.kind === "docker"
    ? { ...captured.connection, kind: "docker" }
    : captured;
}

function cancelled(): never {
  throw Object.assign(new Error("Native memory presentation was retired"), {
    code: "cancelled",
  });
}

export function createNativeMemoryPresentation() {
  let closed = false;
  let revision = 0;
  let opening: Promise<Handle> | null = null;
  let closing: Promise<void> | null = null;
  let reviewRevision = 0;
  let review: Review | null = null;
  let unsettled = 0;
  let current: {
    receipt: NativeMemorySelection;
    token: string;
  } | null = null;

  function handle() {
    if (closed) cancelled();
    opening ??= Promise.resolve().then(() =>
      invoke<Handle>("project_memory_open"),
    );
    return opening;
  }

  function capture(receipt: NativeMemorySelection) {
    if (closed || !current || current.receipt !== receipt) cancelled();
    return current;
  }

  function checkReview(expected: Review) {
    capture(expected.selection);
    if (review !== expected || expected.phase === "consumed") cancelled();
  }

  function deploymentRequest<T>(
    expected: Review,
    command: string,
    args: Record<string, unknown>,
    check: () => void,
  ): Promise<T> {
    if (unsettled >= 256)
      return Promise.reject(
        Object.assign(new Error("Memory requests are busy"), { code: "busy" }),
      );
    unsettled += 1;
    return (async () => {
      try {
        check();
        const selected = capture(expected.selection);
        const owner = await handle();
        check();
        const result = await invoke<T>(command, {
          handle: owner,
          selection: selected.token,
          ...args,
        });
        check();
        return result;
      } catch (error) {
        check();
        throw error;
      } finally {
        unsettled -= 1;
      }
    })();
  }

  async function request<T>(command: string, receipt: NativeMemorySelection) {
    const selected = capture(receipt);
    const owner = await handle();
    capture(receipt);
    try {
      const result = await invoke<T>(command, {
        handle: owner,
        selection: selected.token,
      });
      capture(receipt);
      return result;
    } catch (error) {
      capture(receipt);
      throw error;
    }
  }

  return {
    async select(
      path: string,
      environment: WorkspaceEnv,
      options: Readonly<{ inspectAncestors?: boolean }> = {},
    ) {
      if (closed) cancelled();
      current = null;
      review = null;
      const requested = ++revision;
      if (!Number.isSafeInteger(requested)) cancelled();
      const capturedEnvironment = nativeEnvironment(environment);
      const inspectAncestors = options.inspectAncestors === true;
      const check = () => {
        if (closed || revision !== requested) cancelled();
      };
      try {
        const owner = await handle();
        check();
        const token = await invoke<string>("project_memory_select", {
          handle: owner,
          path,
          environment: capturedEnvironment,
          revision: requested,
          ...(inspectAncestors ? { inspectAncestors: true } : {}),
        });
        check();
        const receipt = Object.freeze({ [selectionBrand]: true as const });
        current = { receipt, token };
        return receipt;
      } catch (error) {
        check();
        throw error;
      }
    },
    discover(receipt: NativeMemorySelection) {
      return request<NativeMemoryScope>("project_memory_discover", receipt);
    },
    initializeLocalState(receipt: NativeMemorySelection) {
      return request<void>("project_memory_initialize_local_state", receipt);
    },
    async preview(
      receipt: NativeMemorySelection,
      input: NativeMemoryPreviewInput,
    ) {
      capture(receipt);
      if (unsettled >= 256)
        throw Object.assign(new Error("Memory requests are busy"), {
          code: "busy",
        });
      const captured = structuredClone(input);
      const requested = ++reviewRevision;
      if (!Number.isSafeInteger(requested)) cancelled();
      const expected: Review = {
        selection: receipt,
        revision: requested,
        receipt: null,
        token: null,
        phase: "opening",
        confirmation: null,
        cancellation: null,
      };
      review = expected;
      try {
        const reply = await deploymentRequest<PreviewReply>(
          expected,
          "project_memory_preview",
          {
            request: {
              ...captured,
              environment: nativeEnvironment(captured.environment),
              revision: requested,
            },
          },
          () => checkReview(expected),
        );
        checkReview(expected);
        if (
          reply.schema !== 1 ||
          reply.revision !== requested ||
          typeof reply.review !== "string"
        )
          cancelled();
        const { review: token, revision: _revision, ...snapshot } = reply;
        const result = Object.freeze({
          [reviewBrand]: true as const,
          snapshot,
        });
        expected.receipt = result;
        expected.token = token;
        expected.phase = "ready";
        return result;
      } catch (error) {
        checkReview(expected);
        throw error;
      }
    },
    confirmPreview(
      receipt: NativeMemorySelection,
      accepted: NativeMemoryReview,
    ): Promise<NativeMemoryPublication> {
      try {
        capture(receipt);
        const expected = review;
        if (
          !expected ||
          expected.selection !== receipt ||
          expected.receipt !== accepted
        )
          cancelled();
        if (expected.phase === "publishing" && expected.confirmation)
          return expected.confirmation;
        if (expected.phase !== "ready" || !expected.token) cancelled();
        expected.phase = "publishing";
        expected.confirmation = deploymentRequest<NativeMemoryPublication>(
          expected,
          "project_memory_confirm_preview",
          { review: expected.token },
          () => checkReview(expected),
        ).finally(() => {
          try {
            checkReview(expected);
          } finally {
            expected.phase = "consumed";
          }
        });
        return expected.confirmation;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    cancelPreview(receipt: NativeMemorySelection): Promise<boolean> {
      try {
        capture(receipt);
        const expected = review;
        if (!expected || expected.selection !== receipt)
          return Promise.resolve(false);
        if (expected.cancellation) return expected.cancellation;
        expected.phase = "consumed";
        expected.cancellation = deploymentRequest<boolean>(
          expected,
          "project_memory_cancel_preview",
          { revision: expected.revision },
          () => {
            capture(receipt);
            if (review !== expected) cancelled();
          },
        ).catch((error: unknown) => {
          expected.cancellation = null;
          throw error;
        });
        return expected.cancellation;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    isCurrent(receipt: NativeMemorySelection) {
      return !closed && current?.receipt === receipt;
    },
    isReviewCurrent(
      receipt: NativeMemorySelection,
      accepted: NativeMemoryReview,
    ) {
      return (
        !closed &&
        current?.receipt === receipt &&
        review?.selection === receipt &&
        review.receipt === accepted &&
        (review.phase === "ready" || review.phase === "publishing")
      );
    },
    close() {
      if (closing) return closing;
      closed = true;
      current = null;
      review = null;
      closing = (async () => {
        if (!opening) return;
        let owner: Handle;
        try {
          owner = await opening;
        } catch {
          return;
        }
        await invoke<void>("project_memory_close", { handle: owner });
      })().catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "cancelled"
        )
          return;
        closing = null;
        throw error;
      });
      return closing;
    },
  };
}
