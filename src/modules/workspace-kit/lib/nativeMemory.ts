import type { WorkspaceEnv } from "@/modules/workspace/env";
import type { KitLock } from "@/modules/workspace-kit/lib/configTypes";
import type { KitDeploymentEntry } from "@/modules/workspace-kit/lib/deployment";
import type { MemoryTransport } from "@/modules/workspace-kit/lib/memoryTransport";
import { loadMemoryDocuments } from "@/modules/workspace-kit/lib/nativeMemoryDocuments";
import {
  memoryRecoveryReview,
  memoryRestorationReport,
  type NativeMemoryRecoveryInput,
  type NativeMemoryRecoveryReview,
} from "@/modules/workspace-kit/lib/nativeMemoryRecovery";
import { createNativeProjectContextClient } from "@/modules/workspace-kit/lib/nativeMemoryProjectContext";
import type { MemoryScope } from "@/modules/workspace-kit/lib/scope";
import { invoke } from "@tauri-apps/api/core";

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
  root: string;
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
  kind: "preview" | "recovery";
  selection: NativeMemorySelection;
  revision: number;
  receipt: NativeMemoryReview | NativeMemoryRecoveryReview | null;
  token: string | null;
  digest: string | null;
  phase: "opening" | "ready" | "publishing" | "restoring" | "consumed";
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

export function createNativeMemoryPresentation(transport?: MemoryTransport) {
  const issue = transport?.invoke ?? invoke;
  let closed = false;
  let revision = 0;
  let opening: Promise<Handle> | null = null;
  let closing: Promise<void> | null = null;
  let reviewRevision = 0;
  let review: Review | null = null;
  let unsettled = 0;
  let acknowledged = false;
  let current: {
    receipt: NativeMemorySelection;
    token: string;
    path: string;
    local: boolean;
  } | null = null;

  function handle() {
    if (closed) cancelled();
    transport?.check();
    opening ??= Promise.resolve().then(() =>
      issue<Handle>("project_memory_open"),
    );
    return opening;
  }

  function capture(receipt: NativeMemorySelection) {
    if (closed || !current || current.receipt !== receipt) cancelled();
    transport?.check();
    return current;
  }

  function checkReview(expected: Review) {
    capture(expected.selection);
    if (review !== expected || expected.phase === "consumed") cancelled();
  }

  function cancelDeployment(
    receipt: NativeMemorySelection,
    kind: Review["kind"],
  ): Promise<boolean> {
    try {
      capture(receipt);
      const expected = review;
      if (!expected || expected.selection !== receipt || expected.kind !== kind)
        return Promise.resolve(false);
      if (expected.cancellation) return expected.cancellation;
      expected.phase = "consumed";
      expected.cancellation = reviewRequest<unknown>(
        expected.selection,
        kind === "preview"
          ? "project_memory_cancel_preview"
          : "project_memory_cancel_recovery",
        { revision: expected.revision },
        () => {
          capture(receipt);
          if (review !== expected) cancelled();
        },
      )
        .then((reply) => {
          capture(receipt);
          if (review !== expected) cancelled();
          if (typeof reply !== "boolean")
            throw Object.assign(
              new Error("Memory cancellation reply is unavailable"),
              { code: "unavailable" },
            );
          return reply;
        })
        .catch((error: unknown) => {
          expected.cancellation = null;
          throw error;
        });
      return expected.cancellation;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function reviewRequest<T>(
    receipt: NativeMemorySelection,
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
        const selected = capture(receipt);
        const owner = await handle();
        check();
        const result = await issue<T>(command, {
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

  async function request<T>(
    command: string,
    receipt: NativeMemorySelection,
    args: Record<string, unknown> = {},
  ) {
    const selected = capture(receipt);
    const owner = await handle();
    capture(receipt);
    try {
      const result = await issue<T>(command, {
        handle: owner,
        selection: selected.token,
        ...args,
      });
      capture(receipt);
      return result;
    } catch (error) {
      capture(receipt);
      throw error;
    }
  }

  const context = createNativeProjectContextClient({
    checkSelection: (receipt) => {
      capture(receipt);
    },
    canRequest: () => unsettled < 256,
    request: reviewRequest,
    contextTransport: transport ? () => transport.retain() : undefined,
  });
  return {
    ...context.api,
    async select(
      path: string,
      environment: WorkspaceEnv,
      options: Readonly<{ inspectAncestors?: boolean }> = {},
    ) {
      if (closed) cancelled();
      current = null;
      review = null;
      context.retire();
      const requested = ++revision;
      if (!Number.isSafeInteger(requested)) cancelled();
      const capturedEnvironment = nativeEnvironment(environment);
      const inspectAncestors = options.inspectAncestors === true;
      const check = () => {
        if (closed || revision !== requested) cancelled();
        transport?.check();
      };
      try {
        const owner = await handle();
        check();
        const token = await issue<string>("project_memory_select", {
          handle: owner,
          path,
          environment: capturedEnvironment,
          revision: requested,
          ...(inspectAncestors ? { inspectAncestors: true } : {}),
        });
        check();
        const receipt = Object.freeze({ [selectionBrand]: true as const });
        current = {
          receipt,
          token,
          path,
          local: capturedEnvironment.kind === "local",
        };
        return receipt;
      } catch (error) {
        check();
        throw error;
      }
    },
    inspect(receipt: NativeMemorySelection) {
      return request<NativeMemoryScope>("project_memory_discover", receipt, {
        inspectionOnly: true,
      });
    },
    async documents(receipt: NativeMemorySelection, root: string) {
      capture(receipt);
      const result = await loadMemoryDocuments(root, () =>
        request("project_memory_documents", receipt, { root }),
      );
      capture(receipt);
      return result;
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
        kind: "preview",
        selection: receipt,
        revision: requested,
        receipt: null,
        token: null,
        digest: null,
        phase: "opening",
        confirmation: null,
        cancellation: null,
      };
      review = expected;
      try {
        const reply = await reviewRequest<PreviewReply>(
          expected.selection,
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
          typeof reply.root !== "string" ||
          !reply.root ||
          reply.root.length > 4096 ||
          /[\x00-\x1f\x7f]/.test(reply.root) ||
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
          expected?.kind !== "preview" ||
          expected.selection !== receipt ||
          expected.receipt !== accepted
        )
          cancelled();
        if (expected.phase === "publishing" && expected.confirmation)
          return expected.confirmation;
        if (expected.phase !== "ready" || !expected.token) cancelled();
        expected.phase = "publishing";
        expected.confirmation = reviewRequest<NativeMemoryPublication>(
          expected.selection,
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
      return cancelDeployment(receipt, "preview");
    },
    async reviewRecovery(
      receipt: NativeMemorySelection,
      input: NativeMemoryRecoveryInput,
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
        kind: "recovery",
        selection: receipt,
        revision: requested,
        receipt: null,
        token: null,
        digest: null,
        phase: "opening",
        confirmation: null,
        cancellation: null,
      };
      review = expected;
      try {
        const reply = await reviewRequest<unknown>(
          receipt,
          "project_memory_review_recovery",
          {
            request: {
              revision: requested,
              destination: captured.destination,
              environment: nativeEnvironment(captured.environment),
            },
          },
          () => checkReview(expected),
        );
        checkReview(expected);
        const result = memoryRecoveryReview(reply, requested);
        expected.receipt = result.receipt;
        expected.token = result.token;
        expected.digest = result.digest;
        expected.phase = "ready";
        return result.receipt;
      } catch (error) {
        checkReview(expected);
        throw error;
      }
    },
    confirmRecovery(
      receipt: NativeMemorySelection,
      accepted: NativeMemoryRecoveryReview,
    ): Promise<NativeMemoryPublication> {
      try {
        capture(receipt);
        const expected = review;
        if (
          expected?.kind !== "recovery" ||
          expected.selection !== receipt ||
          expected.receipt !== accepted
        )
          cancelled();
        if (expected.phase === "restoring" && expected.confirmation)
          return expected.confirmation;
        if (expected.phase !== "ready" || !expected.token || !expected.digest)
          cancelled();
        expected.phase = "restoring";
        expected.confirmation = reviewRequest<unknown>(
          receipt,
          "project_memory_confirm_recovery",
          {
            confirmation: { review: expected.token, digest: expected.digest },
          },
          () => checkReview(expected),
        )
          .then((value) => {
            checkReview(expected);
            return memoryRestorationReport(value, accepted);
          })
          .finally(() => {
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
    cancelRecovery(receipt: NativeMemorySelection): Promise<boolean> {
      return cancelDeployment(receipt, "recovery");
    },
    isRecoveryReviewCurrent(
      receipt: NativeMemorySelection,
      accepted: NativeMemoryRecoveryReview,
    ) {
      try {
        capture(receipt);
      } catch {
        return false;
      }
      return (
        review?.kind === "recovery" &&
        review.selection === receipt &&
        review.receipt === accepted &&
        (review.phase === "ready" || review.phase === "restoring")
      );
    },
    isCurrent(receipt: NativeMemorySelection) {
      try {
        capture(receipt);
        return true;
      } catch {
        return false;
      }
    },
    isLocalSelection(receipt: NativeMemorySelection, path: string) {
      try {
        const selected = capture(receipt);
        return (
          selected.local &&
          selected.path === path &&
          !path.startsWith("remote://")
        );
      } catch {
        return false;
      }
    },
    isSourceSelection(
      receipt: NativeMemorySelection,
      path: string,
      key: string,
    ) {
      try {
        return (
          capture(receipt).path === path &&
          typeof key === "string" &&
          transport?.selectionKey === key
        );
      } catch {
        return false;
      }
    },
    isReviewCurrent(
      receipt: NativeMemorySelection,
      accepted: NativeMemoryReview,
    ) {
      try {
        capture(receipt);
      } catch {
        return false;
      }
      return (
        !closed &&
        current?.receipt === receipt &&
        review?.selection === receipt &&
        review.kind === "preview" &&
        review.receipt === accepted &&
        (review.phase === "ready" || review.phase === "publishing")
      );
    },
    close() {
      if (closing) return closing;
      closed = true;
      current = null;
      review = null;
      context.retire();
      closing = (async () => {
        if (!acknowledged && opening) {
          let owner: Handle | null = null;
          try {
            owner = await opening;
          } catch {
            // A rejected open returned no addressable resource.
          }
          if (owner) {
            try {
              await issue<void>("project_memory_close", { handle: owner });
            } catch (error) {
              if (
                !error ||
                typeof error !== "object" ||
                !("code" in error) ||
                error.code !== "cancelled"
              )
                throw error;
            }
          }
        }
        acknowledged = true;
        await transport?.release();
      })().catch((error: unknown) => {
        closing = null;
        throw error;
      });
      return closing;
    },
  };
}
