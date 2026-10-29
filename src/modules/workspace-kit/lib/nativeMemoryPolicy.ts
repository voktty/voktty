import type { NativeMemorySelection } from "@/modules/workspace-kit/lib/nativeMemory";
import type { NativeMemoryPreference } from "@/modules/workspace-kit/lib/nativeMemoryTrust";

export type NativeMemoryPolicy = NativeMemoryPreference["policy"];
export type NativeMemoryPolicySnapshot = Readonly<{
  schema: 1;
  root: string;
  projectKey: string;
  policy: NativeMemoryPolicy;
  preference: NativeMemoryPreference | null;
}>;
const policyBrand = Symbol("native-memory-policy");
export type NativeMemoryPolicyReview = Readonly<{
  [policyBrand]: true;
  snapshot: NativeMemoryPolicySnapshot;
}>;
export type NativeMemoryPolicyAccepted = Readonly<{
  schema: 1;
  preference: NativeMemoryPreference;
}>;
type Review = {
  selection: NativeMemorySelection;
  revision: number;
  receipt: NativeMemoryPolicyReview | null;
  token: string | null;
  phase: "opening" | "ready" | "accepting" | "consumed";
  confirmation: Promise<NativeMemoryPolicyAccepted> | null;
  cancellation: Promise<boolean> | null;
};
type Owner = {
  checkSelection: (selection: NativeMemorySelection) => void;
  canRequest: () => boolean;
  request: <T>(
    selection: NativeMemorySelection,
    command: string,
    args: Record<string, unknown>,
    check: () => void,
  ) => Promise<T>;
};
function cancelled(): never {
  throw Object.assign(new Error("Memory policy review was retired"), {
    code: "cancelled",
  });
}
function invalid(): never {
  throw Object.assign(new Error("Memory policy reply is unavailable"), {
    code: "unavailable",
  });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
const digest = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 64 &&
  /^[0-9a-f]{64}$/.test(value);
const policy = (value: unknown): value is NativeMemoryPolicy =>
  value === "manual" || value === "always" || value === "never";
function preference(value: unknown, key: string): NativeMemoryPreference {
  const data = record(value);
  if (
    data.projectKey !== key ||
    !policy(data.policy) ||
    (data.instructionDigest !== null && !digest(data.instructionDigest))
  )
    invalid();
  return Object.freeze({
    projectKey: key,
    policy: data.policy,
    instructionDigest: data.instructionDigest as string | null,
  });
}
function snapshot(
  value: unknown,
  revision: number,
  choice: NativeMemoryPolicy,
): { token: string; data: NativeMemoryPolicySnapshot } {
  const reply = record(value);
  if (
    reply.schema !== 1 ||
    reply.revision !== revision ||
    reply.policy !== choice ||
    !digest(reply.projectKey) ||
    typeof reply.review !== "string" ||
    reply.review.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      reply.review,
    ) ||
    typeof reply.root !== "string" ||
    !reply.root ||
    reply.root.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(reply.root)
  )
    invalid();
  for (const char of reply.root) {
    const point = char.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) invalid();
  }
  if (new TextEncoder().encode(reply.root).length > 4096) invalid();
  return {
    token: reply.review,
    data: Object.freeze({
      schema: 1,
      root: reply.root,
      projectKey: reply.projectKey,
      policy: choice,
      preference:
        reply.preference === null
          ? null
          : preference(reply.preference, reply.projectKey),
    }),
  };
}

export function createNativeMemoryPolicyClient(owner: Owner) {
  let revision = 0;
  let current: Review | null = null;
  function check(expected: Review) {
    owner.checkSelection(expected.selection);
    if (current !== expected || expected.phase === "consumed") cancelled();
  }
  return {
    retire() {
      current = null;
    },
    api: {
      async reviewPolicy(
        selection: NativeMemorySelection,
        choice: NativeMemoryPolicy,
      ) {
        owner.checkSelection(selection);
        if (!policy(choice))
          throw Object.assign(new Error("Invalid memory policy"), {
            code: "invalidInput",
          });
        if (!owner.canRequest())
          throw Object.assign(new Error("Memory requests are busy"), {
            code: "busy",
          });
        if (!Number.isSafeInteger(++revision)) cancelled();
        const expected: Review = {
          selection,
          revision,
          receipt: null,
          token: null,
          phase: "opening",
          confirmation: null,
          cancellation: null,
        };
        current = expected;
        try {
          const reply = await owner.request<unknown>(
            selection,
            "project_memory_review_policy",
            { request: { revision, policy: choice } },
            () => check(expected),
          );
          check(expected);
          const { token, data } = snapshot(reply, expected.revision, choice);
          const receipt = Object.freeze({
            [policyBrand]: true as const,
            snapshot: data,
          });
          expected.receipt = receipt;
          expected.token = token;
          expected.phase = "ready";
          return receipt;
        } catch (error) {
          check(expected);
          throw error;
        }
      },
      confirmPolicy(
        selection: NativeMemorySelection,
        accepted: NativeMemoryPolicyReview,
      ): Promise<NativeMemoryPolicyAccepted> {
        try {
          owner.checkSelection(selection);
          const expected = current;
          if (
            !expected ||
            expected.selection !== selection ||
            expected.receipt !== accepted
          )
            cancelled();
          if (expected.phase === "accepting" && expected.confirmation)
            return expected.confirmation;
          if (expected.phase !== "ready" || !expected.token) cancelled();
          expected.phase = "accepting";
          expected.confirmation = owner
            .request<unknown>(
              selection,
              "project_memory_confirm_policy",
              { review: expected.token },
              () => check(expected),
            )
            .then((value) => {
              check(expected);
              const reply = record(value);
              if (reply.schema !== 1) invalid();
              const result = preference(
                reply.preference,
                accepted.snapshot.projectKey,
              );
              if (
                result.policy !== accepted.snapshot.policy ||
                result.instructionDigest !==
                  (accepted.snapshot.preference?.instructionDigest ?? null)
              )
                invalid();
              return Object.freeze({ schema: 1 as const, preference: result });
            })
            .finally(() => {
              try {
                check(expected);
              } finally {
                expected.phase = "consumed";
              }
            });
          return expected.confirmation;
        } catch (error) {
          return Promise.reject(error);
        }
      },
      cancelPolicy(selection: NativeMemorySelection): Promise<boolean> {
        try {
          owner.checkSelection(selection);
          const expected = current;
          if (!expected || expected.selection !== selection)
            return Promise.resolve(false);
          if (expected.cancellation) return expected.cancellation;
          expected.phase = "consumed";
          expected.cancellation = owner
            .request<unknown>(
              selection,
              "project_memory_cancel_policy",
              { revision: expected.revision },
              () => {
                owner.checkSelection(selection);
                if (current !== expected) cancelled();
              },
            )
            .then((reply) => {
              owner.checkSelection(selection);
              if (current !== expected) cancelled();
              if (typeof reply !== "boolean") invalid();
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
      },
      isPolicyReviewCurrent(
        selection: NativeMemorySelection,
        accepted: NativeMemoryPolicyReview,
      ) {
        try {
          owner.checkSelection(selection);
        } catch {
          return false;
        }
        return (
          current?.selection === selection &&
          current.receipt === accepted &&
          (current.phase === "ready" || current.phase === "accepting")
        );
      },
    },
  };
}
