import type { WorkspaceEnv } from "@/modules/workspace/env";
import { createMemoryClient } from "@/modules/workspace-kit/lib/memoryClient";
import { memoryStorageDiagnostic } from "@/modules/workspace-kit/lib/memoryStorageDiagnostic";
import type {
  createNativeMemoryPresentation,
  NativeMemoryDeploymentError,
  NativeMemoryPublication,
  NativeMemoryReview,
  NativeMemoryScope,
  NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import { authorizeNativeMemoryDirectory } from "@/modules/workspace-kit/lib/nativeMemoryAuthorization";
import type { MemoryDocuments } from "@/modules/workspace-kit/lib/nativeMemoryDocuments";
import type {
  NativeMemoryPolicy,
  NativeMemoryPolicyAccepted,
  NativeMemoryPolicyReview,
} from "@/modules/workspace-kit/lib/nativeMemoryPolicy";
import type { NativeMemoryRecoveryReview } from "@/modules/workspace-kit/lib/nativeMemoryRecovery";
import type {
  NativeMemoryTrustAccepted,
  NativeMemoryTrustReview,
} from "@/modules/workspace-kit/lib/nativeMemoryTrust";

export type MemoryPanelTarget = Readonly<{
  path: string;
  environment: WorkspaceEnv;
  source: string;
}>;
export type MemoryTrustState =
  | { status: "trustLoading" }
  | {
      status: "trustReview";
      review: NativeMemoryTrustReview;
    }
  | { status: "trustAccepting"; review: NativeMemoryTrustReview }
  | { status: "trustAccepted"; root: string; report: NativeMemoryTrustAccepted }
  | { status: "trustError"; code: string };
export type MemoryPanelState =
  | MemoryRecoveryState
  | MemoryDocumentsState
  | MemoryPolicyState
  | MemoryTrustState
  | { status: "loading" }
  | { status: "ready"; observation: NativeMemoryScope }
  | { status: "error"; code: string; canPrepare: boolean }
  | { status: "configuring"; recovering?: boolean }
  | { status: "initializationSetup"; code?: string; diagnostic?: string }
  | { status: "preparingInitialization" }
  | { status: "previewing" }
  | { status: "review" | "publishing"; review: NativeMemoryReview }
  | { status: "published"; root: string; report: NativeMemoryPublication }
  | { status: "deploymentError"; error: NativeMemoryDeploymentError };
export type MemoryRecoveryState =
  | { status: "recoveryLoading" }
  | {
      status: "recoveryReview";
      review: NativeMemoryRecoveryReview;
    }
  | { status: "recoveryRestoring"; review: NativeMemoryRecoveryReview }
  | {
      status: "recoveryRestored";
      root: string;
      report: NativeMemoryPublication;
    }
  | { status: "recoveryError"; error: NativeMemoryDeploymentError };
export type MemoryDocumentsState =
  | { status: "documentsLoading" }
  | { status: "documentsReady"; snapshot: MemoryDocuments }
  | { status: "documentsError"; code: string };
export type MemoryPolicyState =
  | { status: "policyConfiguring" }
  | { status: "policyLoading" }
  | { status: "policyReview"; review: NativeMemoryPolicyReview }
  | { status: "policyAccepting"; review: NativeMemoryPolicyReview }
  | {
      status: "policyAccepted";
      root: string;
      report: NativeMemoryPolicyAccepted;
    }
  | { status: "policyError"; code: string };
type Client = Pick<
  ReturnType<typeof createNativeMemoryPresentation>,
  | "select"
  | "isCurrent"
  | "discover"
  | "inspect"
  | "documents"
  | "initializeLocalState"
  | "close"
  | "preview"
  | "confirmPreview"
  | "cancelPreview"
  | "isReviewCurrent"
  | "reviewRecovery"
  | "confirmRecovery"
  | "cancelRecovery"
  | "isRecoveryReviewCurrent"
  | "reviewTrust"
  | "confirmTrust"
  | "cancelTrust"
  | "isTrustReviewCurrent"
  | "reviewPolicy"
  | "confirmPolicy"
  | "cancelPolicy"
  | "isPolicyReviewCurrent"
>;
type Entry = {
  client: Client;
  retired: boolean;
  closing: Promise<boolean> | null;
};
const entries = new Set<Entry>();
const MAX_PANELS = 256;

function closeEntry(entry: Entry): Promise<boolean> {
  if (entry.closing) return entry.closing;
  entry.retired = true;
  entry.closing = Promise.resolve()
    .then(() => entry.client.close())
    .then(
      () => {
        entries.delete(entry);
        return true;
      },
      () => {
        entry.closing = null;
        return false;
      },
    );
  return entry.closing;
}

export function createMemoryPanelController(
  target: MemoryPanelTarget,
  publish: (state: MemoryPanelState) => void,
  createClient: () => Client = () => createMemoryClient(target),
  authorizeDirectory: (path: string) => Promise<string> = (path) => {
    if (target.environment.kind !== "local" || path.startsWith("remote://"))
      return Promise.reject({ code: "unsupported" });
    return authorizeNativeMemoryDirectory(path);
  },
) {
  for (const entry of entries) if (entry.retired) void closeEntry(entry);
  if (entries.size >= MAX_PANELS)
    throw Object.assign(new Error("Project memory panels are busy"), {
      code: "busy",
    });
  const captured = structuredClone(target);
  const entry: Entry = {
    client: createClient(),
    retired: false,
    closing: null,
  };
  entries.add(entry);
  let selected: NativeMemorySelection | null = null;
  let pending: Promise<void> | null = null;
  let state: MemoryPanelState = { status: "loading" };
  let observation: NativeMemoryScope | null = null;
  let selectionPath = captured.path;
  let recoveringInitialization = false;
  const current = () =>
    !entry.retired && selected !== null && entry.client.isCurrent(selected);
  const notify = (next: MemoryPanelState) => {
    if (!entry.retired) {
      state = next;
      publish(next);
    }
  };
  function run(prepare: boolean, inspectAncestors = false, authorize = false) {
    if (entry.retired) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve()
      .then(async () => {
        if (entry.retired) return;
        notify({ status: "loading" });
        if (entry.retired) return;
        try {
          if (authorize) {
            selected = null;
            const path = await authorizeDirectory(captured.path);
            if (entry.retired) return;
            selectionPath = path;
          }
          if (inspectAncestors) selected = null;
          if (!selected)
            selected = await entry.client.select(
              selectionPath,
              captured.environment,
              ...(inspectAncestors
                ? ([{ inspectAncestors: true }] as const)
                : []),
            );
          const receipt = selected;
          if (!receipt || !current()) return;
          if (prepare) {
            await entry.client.initializeLocalState(receipt);
            if (!current()) return;
          }
          const observed = prepare
            ? await entry.client.discover(receipt)
            : await entry.client.inspect(receipt);
          if (!current()) return;
          observation = observed;
          notify({ status: "ready", observation: observed });
        } catch (error) {
          if (entry.retired) return;
          const code =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string" &&
            [
              "invalidInput",
              "denied",
              "cancelled",
              "timeout",
              "busy",
              "limit",
              "unsupported",
              "missingState",
              "invalidState",
              "stale",
              "unavailable",
            ].includes(error.code)
              ? error.code
              : "unavailable";
          notify({
            status: "error",
            code,
            canPrepare:
              current() && (code === "unavailable" || code === "missingState"),
          });
        }
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  function deploy(
    work: (receipt: NativeMemorySelection) => Promise<void>,
    operation:
      | "deployment"
      | "trust"
      | "policy"
      | "documents"
      | "recovery"
      | "setup" = "deployment",
  ) {
    if (entry.retired || !selected || !current()) return Promise.resolve();
    if (pending) return pending;
    const receipt = selected;
    pending = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        try {
          await work(receipt);
        } catch (error) {
          if (!current()) return;
          const failure =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
              ? (error as NativeMemoryDeploymentError)
              : { code: "unavailable" };
          notify(
            operation === "setup"
              ? {
                  status: "initializationSetup",
                  diagnostic: memoryStorageDiagnostic(error),
                  code: [
                    "denied",
                    "missingState",
                    "invalidState",
                    "unsupported",
                    "unavailable",
                    "timeout",
                    "busy",
                    "limit",
                    "stale",
                  ].includes(failure.code)
                    ? failure.code
                    : "unavailable",
                }
              : operation === "recovery"
                ? { status: "recoveryError", error: failure }
                : operation === "documents"
                  ? { status: "documentsError", code: failure.code }
                  : operation === "trust"
                    ? { status: "trustError", code: failure.code }
                    : operation === "policy"
                      ? { status: "policyError", code: failure.code }
                      : { status: "deploymentError", error: failure },
          );
        }
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  return {
    load: () => run(false),
    configureInterruptedInitialization() {
      if (
        pending ||
        !current() ||
        state.status !== "ready" ||
        !canReviewMemoryRecovery(captured, state.observation)
      )
        return;
      recoveringInitialization = true;
      notify({ status: "configuring", recovering: true });
    },
    reviewRecovery() {
      if (
        !supportsMemoryRecovery(captured) ||
        !(
          (state.status === "ready" &&
            canReviewMemoryRecovery(captured, state.observation)) ||
          (state.status === "deploymentError" &&
            ["recoveryRequired", "pendingRecovery"].includes(
              state.error.code,
            )) ||
          (state.status === "review" &&
            state.review.snapshot.publicationBlocker === "recoveryRequired") ||
          state.status === "recoveryError"
        )
      )
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "recoveryLoading" });
        if (!current()) return;
        const review = await entry.client.reviewRecovery(receipt, {
          destination: selectionPath,
          environment: captured.environment,
        });
        if (current() && entry.client.isRecoveryReviewCurrent(receipt, review))
          notify({ status: "recoveryReview", review });
      }, "recovery");
    },
    confirmRecovery(accepted: NativeMemoryRecoveryReview) {
      if (
        state.status !== "recoveryReview" ||
        state.review !== accepted ||
        !selected ||
        !entry.client.isRecoveryReviewCurrent(selected, accepted)
      )
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "recoveryRestoring", review: accepted });
        if (
          !current() ||
          !entry.client.isRecoveryReviewCurrent(receipt, accepted)
        )
          return;
        const report = await entry.client.confirmRecovery(receipt, accepted);
        if (current()) {
          observation = null;
          notify({
            status: "recoveryRestored",
            root: accepted.snapshot.root,
            report,
          });
        }
      }, "recovery");
    },
    resumeInitialization() {
      if (state.status !== "recoveryRestored") return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "recoveryLoading" });
        if (!current()) return;
        const observed = await entry.client.inspect(receipt);
        if (!current()) return;
        observation = observed;
        recoveringInitialization = true;
        notify({ status: "configuring", recovering: true });
      }, "recovery");
    },
    backRecovery() {
      if (
        pending ||
        !current() ||
        !["recoveryReview", "recoveryError"].includes(state.status)
      )
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "recoveryLoading" });
        if (!current()) return;
        await entry.client.cancelRecovery(receipt);
        if (!current()) return;
        const observed = await entry.client.inspect(receipt);
        if (current()) {
          observation = observed;
          notify({ status: "ready", observation: observed });
        }
      }, "recovery");
    },
    browseDocuments() {
      if (
        !observation ||
        !canReviewMemoryTrust(observation) ||
        !["ready", "documentsReady", "documentsError"].includes(state.status)
      )
        return Promise.resolve();
      const root = observation.root;
      if (!root) return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "documentsLoading" });
        if (!current()) return;
        const snapshot = await entry.client.documents(receipt, root);
        if (current() && observation?.root === root)
          notify({ status: "documentsReady", snapshot });
      }, "documents");
    },
    backDocuments() {
      if (
        !pending &&
        current() &&
        observation &&
        (state.status === "documentsReady" || state.status === "documentsError")
      )
        notify({ status: "ready", observation });
    },
    authorize() {
      if (
        state.status !== "error" ||
        state.code !== "denied" ||
        captured.environment.kind !== "local" ||
        captured.path.startsWith("remote://") ||
        !supportedMemoryPanelTarget(captured)
      )
        return Promise.resolve();
      return run(false, false, true);
    },
    configurePolicy() {
      if (
        !pending &&
        current() &&
        state.status === "ready" &&
        canReviewMemoryPolicy(state.observation)
      )
        notify({ status: "policyConfiguring" });
    },
    reviewPolicy(choice: NativeMemoryPolicy) {
      if (state.status !== "policyConfiguring") return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "policyLoading" });
        if (!current()) return;
        const review = await entry.client.reviewPolicy(receipt, choice);
        if (current() && entry.client.isPolicyReviewCurrent(receipt, review))
          notify({ status: "policyReview", review });
      }, "policy");
    },
    confirmPolicy(accepted: NativeMemoryPolicyReview) {
      if (
        state.status !== "policyReview" ||
        state.review !== accepted ||
        !selected ||
        !entry.client.isPolicyReviewCurrent(selected, accepted)
      )
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "policyAccepting", review: accepted });
        if (
          !current() ||
          !entry.client.isPolicyReviewCurrent(receipt, accepted)
        )
          return;
        const report = await entry.client.confirmPolicy(receipt, accepted);
        if (current())
          notify({
            status: "policyAccepted",
            root: accepted.snapshot.root,
            report,
          });
      }, "policy");
    },
    backPolicy() {
      if (pending || !current() || !observation) return Promise.resolve();
      if (
        state.status === "policyConfiguring" ||
        state.status === "policyAccepted"
      ) {
        notify({ status: "ready", observation });
        return Promise.resolve();
      }
      if (state.status !== "policyReview" && state.status !== "policyError")
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "policyLoading" });
        if (!current()) return;
        await entry.client.cancelPolicy(receipt);
        if (current()) notify({ status: "policyConfiguring" });
      }, "policy");
    },
    reviewTrust() {
      if (state.status !== "ready" || !canReviewMemoryTrust(state.observation))
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "trustLoading" });
        if (!current()) return;
        const review = await entry.client.reviewTrust(receipt);
        if (current() && entry.client.isTrustReviewCurrent(receipt, review))
          notify({ status: "trustReview", review });
      }, "trust");
    },
    confirmTrust(accepted: NativeMemoryTrustReview) {
      if (
        state.status !== "trustReview" ||
        state.review !== accepted ||
        !selected ||
        !entry.client.isTrustReviewCurrent(selected, accepted)
      )
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "trustAccepting", review: accepted });
        if (!current()) return;
        const report = await entry.client.confirmTrust(receipt, accepted);
        if (current())
          notify({
            status: "trustAccepted",
            root: accepted.snapshot.root,
            report,
          });
      }, "trust");
    },
    backTrust() {
      if (pending || !current() || !observation) return Promise.resolve();
      if (state.status === "trustAccepted") {
        notify({ status: "ready", observation });
        return Promise.resolve();
      }
      if (state.status !== "trustReview" && state.status !== "trustError")
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "trustLoading" });
        if (!current()) return;
        await entry.client.cancelTrust(receipt);
        if (current() && observation) notify({ status: "ready", observation });
      }, "trust");
    },
    prepare: () => run(true),
    inspectAncestors() {
      if (
        state.status !== "ready" ||
        state.observation.scope?.state !== "incomplete" ||
        state.observation.scope.ancestryComplete
      )
        return Promise.resolve();
      return run(false, true);
    },
    configure() {
      if (
        !pending &&
        current() &&
        state.status === "ready" &&
        canInitializeMemory(state.observation)
      )
        notify({ status: "initializationSetup" });
    },
    prepareInitialization() {
      if (state.status !== "initializationSetup") return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "preparingInitialization" });
        if (!current()) return;
        await entry.client.initializeLocalState(receipt);
        if (current()) notify({ status: "configuring" });
      }, "setup");
    },
    preview(
      inputs: Readonly<Record<string, string>>,
      links: Readonly<{ agents: boolean; claude: boolean }>,
    ) {
      if (state.status !== "configuring") return Promise.resolve();
      const values = structuredClone(inputs);
      const choices = structuredClone(links);
      return deploy(async (receipt) => {
        notify({ status: "previewing" });
        if (!current()) return;
        const review = await entry.client.preview(receipt, {
          destination: selectionPath,
          environment: captured.environment,
          inputs: values,
          links: choices,
        });
        if (current() && entry.client.isReviewCurrent(receipt, review))
          notify({ status: "review", review });
      });
    },
    confirm(accepted: NativeMemoryReview) {
      if (
        state.status !== "review" ||
        state.review !== accepted ||
        !selected ||
        !entry.client.isReviewCurrent(selected, accepted) ||
        !accepted.snapshot.deployment.canPublish ||
        accepted.snapshot.publicationBlocker
      )
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "publishing", review: accepted });
        if (!current()) return;
        const report = await entry.client.confirmPreview(receipt, accepted);
        if (current())
          notify({ status: "published", root: accepted.snapshot.root, report });
      });
    },
    back() {
      if (pending || !current() || !observation) return Promise.resolve();
      if (state.status === "deploymentError") {
        notify({
          status: "configuring",
          ...(recoveringInitialization ? { recovering: true } : {}),
        });
        return Promise.resolve();
      }
      if (
        state.status === "configuring" ||
        state.status === "initializationSetup"
      ) {
        notify({ status: "ready", observation });
        return Promise.resolve();
      }
      if (state.status !== "review") return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "previewing" });
        if (!current()) return;
        await entry.client.cancelPreview(receipt);
        if (current()) notify({ status: "configuring" });
      });
    },
    dispose: () => closeEntry(entry),
  };
}

export function canInitializeMemory(observation: NativeMemoryScope) {
  return (
    observation.scope?.ancestryComplete === true &&
    observation.blockedCount === 0 &&
    !observation.root &&
    (observation.scope.state === "absent" ||
      observation.scope.state === "reserved")
  );
}

export function supportsMemoryRecovery(target: MemoryPanelTarget) {
  return (
    target.environment.kind === "local" &&
    !target.path.startsWith("remote://") &&
    supportedMemoryPanelTarget(target)
  );
}

export function canReviewMemoryRecovery(
  target: MemoryPanelTarget,
  observation: NativeMemoryScope,
) {
  return (
    supportsMemoryRecovery(target) &&
    (["partial", "invalid", "ambiguous"].includes(observation.scope?.state) ||
      (observation.scope?.state === "incomplete" &&
        observation.blockedCount > 0))
  );
}

export function canReviewMemoryTrust(observation: NativeMemoryScope) {
  return (
    observation.scope?.state === "ready" &&
    observation.scope.ancestryComplete === true &&
    observation.blockedCount === 0 &&
    typeof observation.root === "string" &&
    observation.root.length > 0
  );
}

export function canReviewMemoryPolicy(observation: NativeMemoryScope) {
  return canReviewMemoryTrust(observation);
}

export function supportedMemoryPanelTarget(target: MemoryPanelTarget) {
  return (
    (target.environment.kind === "local" ||
      target.environment.kind === "ssh") &&
    target.path.length > 0 &&
    target.path.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(target.path)
  );
}
