import type { NativeMemorySelection } from "@/modules/workspace-kit/lib/nativeMemory";
import type { KitConfig } from "@/modules/workspace-kit/lib/configTypes";
import type { InstructionFingerprint } from "@/modules/workspace-kit/lib/context";

export type NativeMemoryPreference = Readonly<{
  projectKey: string;
  policy: "manual" | "always" | "never";
  instructionDigest: string | null;
}>;
export type NativeMemoryTrustSnapshot = Readonly<{
  schema: 1;
  root: string;
  projectKey: string;
  config: KitConfig;
  instructions: Readonly<{
    schema: 1;
    role: string | null;
    files: readonly Readonly<{
      path: string;
      fact:
        | Readonly<{ kind: "file"; text: string }>
        | Readonly<{ kind: "absent" }>;
    }>[];
  }>;
  fingerprint: InstructionFingerprint;
  preference: NativeMemoryPreference | null;
}>;
const trustBrand = Symbol("native-memory-trust");
export type NativeMemoryTrustReview = Readonly<{
  [trustBrand]: true;
  snapshot: NativeMemoryTrustSnapshot;
}>;
export type NativeMemoryTrustAccepted = Readonly<{
  schema: 1;
  preference: NativeMemoryPreference;
}>;
type Reply = NativeMemoryTrustSnapshot & { review: string; revision: number };
type Review = {
  selection: NativeMemorySelection;
  revision: number;
  receipt: NativeMemoryTrustReview | null;
  token: string | null;
  phase: "opening" | "ready" | "accepting" | "consumed";
  confirmation: Promise<NativeMemoryTrustAccepted> | null;
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
  throw Object.assign(new Error("Memory trust review was retired"), {
    code: "cancelled",
  });
}
function invalid(): never {
  throw Object.assign(new Error("Memory trust reply is unavailable"), {
    code: "unavailable",
  });
}
const digest = (text: unknown): text is string =>
  typeof text === "string" && text.length === 64 && /^[0-9a-f]{64}$/.test(text);
function preference(value: NativeMemoryPreference | null, key: string) {
  return (
    value === null ||
    (value?.projectKey === key &&
      ["manual", "always", "never"].includes(value.policy) &&
      (value.instructionDigest === null || digest(value.instructionDigest)))
  );
}
function snapshot(reply: Reply, revision: number): NativeMemoryTrustSnapshot {
  if (
    reply?.schema !== 1 ||
    reply.revision !== revision ||
    typeof reply.root !== "string" ||
    !reply.root ||
    reply.root.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(reply.root) ||
    !digest(reply.projectKey) ||
    typeof reply.review !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      reply.review,
    ) ||
    reply.instructions?.schema !== 1 ||
    !Array.isArray(reply.instructions.files) ||
    !reply.instructions.files.length ||
    reply.instructions.files.length > 128 ||
    reply.fingerprint?.schema !== 1 ||
    !digest(reply.fingerprint.digest) ||
    !Array.isArray(reply.fingerprint.files) ||
    reply.fingerprint.files.length !== reply.instructions.files.length ||
    reply.fingerprint.role !== reply.instructions.role ||
    (reply.instructions.role !== null &&
      (typeof reply.instructions.role !== "string" ||
        reply.instructions.role.length > 256)) ||
    !preference(reply.preference, reply.projectKey) ||
    !reply.config ||
    typeof reply.config !== "object" ||
    Array.isArray(reply.config)
  )
    invalid();
  const paths = new Set<string>();
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const file of reply.instructions.files) {
    if (
      typeof file?.path !== "string" ||
      !file.path ||
      file.path.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(file.path) ||
      paths.has(file.path)
    )
      invalid();
    paths.add(file.path);
    const hash = reply.fingerprint.files.find(
      (entry) => entry?.path === file.path,
    );
    if (file.fact?.kind === "file") {
      if (
        typeof file.fact.text !== "string" ||
        file.fact.text.length > 256 * 1024 ||
        file.fact.text.includes("\0") ||
        hash?.kind !== "file" ||
        !digest(hash.sha256)
      )
        invalid();
      const size = encoder.encode(file.fact.text).length;
      bytes += size;
      if (size > 256 * 1024 || bytes > 2 * 1024 * 1024) invalid();
    } else if (
      file.fact?.kind !== "absent" ||
      hash?.kind !== "absent" ||
      hash.sha256 !== null
    )
      invalid();
  }
  let nodes = 0;
  let configBytes = 0;
  const seen = new Set<object>();
  function checkConfig(value: unknown, depth: number): void {
    if (depth > 16 || ++nodes > 8192) invalid();
    if (typeof value === "string") {
      if (value.length > 256 * 1024) invalid();
      configBytes += encoder.encode(value).length;
      if (configBytes > 256 * 1024) invalid();
    }
    if (value && typeof value === "object") {
      if (seen.has(value)) invalid();
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        if (key.length > 256 * 1024) invalid();
        configBytes += encoder.encode(key).length;
        if (configBytes > 256 * 1024) invalid();
        checkConfig(child, depth + 1);
      }
    } else if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      invalid();
  }
  checkConfig(reply.config, 0);
  const data: NativeMemoryTrustSnapshot = structuredClone({
    schema: 1,
    root: reply.root,
    projectKey: reply.projectKey,
    config: reply.config,
    instructions: {
      schema: 1,
      role: reply.instructions.role,
      files: reply.instructions.files.map((file) => ({
        path: file.path,
        fact:
          file.fact.kind === "file"
            ? { kind: "file" as const, text: file.fact.text }
            : { kind: "absent" as const },
      })),
    },
    fingerprint: {
      schema: 1,
      digest: reply.fingerprint.digest,
      role: reply.fingerprint.role,
      files: reply.fingerprint.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        sha256: file.sha256,
      })),
    },
    preference: reply.preference
      ? {
          projectKey: reply.preference.projectKey,
          policy: reply.preference.policy,
          instructionDigest: reply.preference.instructionDigest,
        }
      : null,
  });
  function freeze(value: unknown): void {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(data);
  return data;
}

export function createNativeMemoryTrustClient(owner: Owner) {
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
      async reviewTrust(
        selection: NativeMemorySelection,
        role: string | null = null,
      ) {
        owner.checkSelection(selection);
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
          const reply = await owner.request<Reply>(
            selection,
            "project_memory_review_trust",
            { request: { revision, role } },
            () => check(expected),
          );
          check(expected);
          const data = snapshot(reply, expected.revision);
          const receipt = Object.freeze({
            [trustBrand]: true as const,
            snapshot: data,
          });
          expected.receipt = receipt;
          expected.token = reply.review;
          expected.phase = "ready";
          return receipt;
        } catch (error) {
          check(expected);
          throw error;
        }
      },
      confirmTrust(
        selection: NativeMemorySelection,
        accepted: NativeMemoryTrustReview,
      ): Promise<NativeMemoryTrustAccepted> {
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
            .request<NativeMemoryTrustAccepted>(
              selection,
              "project_memory_confirm_trust",
              { review: expected.token },
              () => check(expected),
            )
            .then((reply) => {
              check(expected);
              if (
                reply?.schema !== 1 ||
                !reply.preference ||
                !preference(reply.preference, accepted.snapshot.projectKey) ||
                reply.preference.policy !==
                  (accepted.snapshot.preference?.policy ?? "manual") ||
                reply.preference.instructionDigest !==
                  accepted.snapshot.fingerprint.digest
              )
                invalid();
              return Object.freeze({
                schema: 1 as const,
                preference: Object.freeze({
                  projectKey: reply.preference.projectKey,
                  policy: reply.preference.policy,
                  instructionDigest: reply.preference.instructionDigest,
                }),
              });
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
      cancelTrust(selection: NativeMemorySelection): Promise<boolean> {
        try {
          owner.checkSelection(selection);
          const expected = current;
          if (!expected || expected.selection !== selection)
            return Promise.resolve(false);
          if (expected.cancellation) return expected.cancellation;
          expected.phase = "consumed";
          expected.cancellation = owner
            .request<boolean>(
              selection,
              "project_memory_cancel_trust",
              { revision: expected.revision },
              () => {
                owner.checkSelection(selection);
                if (current !== expected) cancelled();
              },
            )
            .catch((error: unknown) => {
              expected.cancellation = null;
              throw error;
            });
          return expected.cancellation;
        } catch (error) {
          return Promise.reject(error);
        }
      },
      isTrustReviewCurrent(
        selection: NativeMemorySelection,
        accepted: NativeMemoryTrustReview,
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
