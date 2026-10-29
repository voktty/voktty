import type { WorkspaceEnv } from "@/modules/workspace/env";
import {
  createNativeMemoryPresentation,
  type NativeMemoryScope,
  type NativeMemorySelection,
  type NativeMemoryReview,
  type NativeMemoryPublication,
  type NativeMemoryDeploymentError,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type {
  NativeMemoryTrustReview,
  NativeMemoryTrustAccepted,
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
  | MemoryTrustState
  | { status: "loading" }
  | { status: "ready"; observation: NativeMemoryScope }
  | { status: "error"; code: string; canPrepare: boolean }
  | { status: "configuring" }
  | { status: "previewing" }
  | { status: "review" | "publishing"; review: NativeMemoryReview }
  | { status: "published"; root: string; report: NativeMemoryPublication }
  | { status: "deploymentError"; error: NativeMemoryDeploymentError };
type Client = Pick<
  ReturnType<typeof createNativeMemoryPresentation>,
  | "select"
  | "isCurrent"
  | "discover"
  | "initializeLocalState"
  | "close"
  | "preview"
  | "confirmPreview"
  | "cancelPreview"
  | "isReviewCurrent"
  | "reviewTrust"
  | "confirmTrust"
  | "cancelTrust"
  | "isTrustReviewCurrent"
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
  createClient: () => Client = createNativeMemoryPresentation,
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
  const current = () =>
    !entry.retired && selected !== null && entry.client.isCurrent(selected);
  const notify = (next: MemoryPanelState) => {
    if (!entry.retired) {
      state = next;
      publish(next);
    }
  };
  function run(prepare: boolean, inspectAncestors = false) {
    if (entry.retired) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve()
      .then(async () => {
        if (entry.retired) return;
        notify({ status: "loading" });
        if (entry.retired) return;
        try {
          if (inspectAncestors) selected = null;
          if (!selected)
            selected = await entry.client.select(
              captured.path,
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
          const observed = await entry.client.discover(receipt);
          if (!current()) return;
          observation = observed;
          notify({ status: "ready", observation: observed });
        } catch (error) {
          if (entry.retired) return;
          const code =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
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
    trust = false,
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
            trust
              ? { status: "trustError", code: failure.code }
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
    reviewTrust() {
      if (state.status !== "ready" || !canReviewMemoryTrust(state.observation))
        return Promise.resolve();
      return deploy(async (receipt) => {
        notify({ status: "trustLoading" });
        if (!current()) return;
        const review = await entry.client.reviewTrust(receipt);
        if (current() && entry.client.isTrustReviewCurrent(receipt, review))
          notify({ status: "trustReview", review });
      }, true);
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
      }, true);
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
      }, true);
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
        notify({ status: "configuring" });
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
          destination: captured.path,
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
        notify({ status: "configuring" });
        return Promise.resolve();
      }
      if (state.status === "configuring") {
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

export function canReviewMemoryTrust(observation: NativeMemoryScope) {
  return (
    observation.scope?.state === "ready" &&
    observation.scope.ancestryComplete === true &&
    observation.blockedCount === 0 &&
    typeof observation.root === "string" &&
    observation.root.length > 0
  );
}

export function supportedMemoryPanelTarget(target: MemoryPanelTarget) {
  return (
    target.environment.kind === "local" &&
    !target.path.startsWith("remote://") &&
    target.path.length > 0 &&
    target.path.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(target.path)
  );
}
