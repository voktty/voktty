import { t } from "@/modules/i18n";

import { flushSync } from "react-dom";
import {
  displayAttachments,
  prepareAttachments,
} from "@/modules/harness/lib/attachments";
import {
  beginSessionTurn,
  captureSessionCheckpoint,
  notifyReviewChanged,
  prepareSessionCheckpoint,
  syncSessionCheckpoint,
} from "@/modules/harness/lib/checkpoint";
import { dropContextWindow } from "@/modules/harness/lib/contextUsage";
import { syncDockBadge } from "@/modules/harness/lib/dockBadge";
import { invalidateProjectFiles } from "@/modules/harness/lib/fileIndex";
import { notifyDirsChanged } from "@/modules/harness/lib/fileTree";
import { nudgeWatchedFiles } from "@/modules/harness/lib/fileWatch";
import { notifyGitChanged } from "@/modules/harness/lib/fs";
import { inboxAskPrompt } from "@/modules/harness/lib/inboxAsk";
import {
  type HandoffComposerCard,
  appendPreparingHandoff,
  buildDeterministicHandoff,
  chooseHandoffBrief,
  completeHandoff,
  consumeHandoff,
  handoffTurnCard,
  isPreparingHandoff,
  pendingHandoff,
  planComposerSwitch,
  sessionChildHarnesses,
  shouldAskOutgoingAgent,
  userMessagesAfterHandoff,
  wrapHandoffPrompt,
} from "@/modules/harness/lib/handoff";
import { requestOutgoingHandoff } from "@/modules/harness/lib/handoffTurn";
import {
  type ApprovalDecision,
  appendSteerUser,
  appendUser,
  applyHarnessEvent,
  canCompactHarnessContext,
  canRewindHarnessLastTurn,
  cancelHarnessTurn,
  canSteerHarness,
  compactHarnessContext,
  forgetHarnessSession,
  generateHarnessTitle,
  type HarnessEvent,
  isLiveHarness,
  promoteLastAssistantToPlan,
  respondHarnessApproval,
  respondHarnessQuestion,
  keepHarnessQuestionOpen,
  rewindHarnessLastTurn,
  sendHarnessTurn,
  steerHarnessTurn,
  stopStreaming,
  type UserQuestionReply,
} from "@/modules/harness/lib/harness";
import { isEditTool } from "@/modules/harness/lib/harness/preview";
import {
  CONTINUE_PROMPT,
  canAutoContinue,
} from "@/modules/harness/lib/inFlight";
import {
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
} from "@/modules/harness/lib/messageQueue";
import {
  mergeModelSettings,
  preferredModelSettings,
  resolveModel,
  saveLastModelSettings,
  saveRecentModelChoice,
} from "@/modules/harness/lib/models";
import {
  loadFollowUpBehavior,
  type FollowUpBehavior,
} from "@/modules/harness/lib/settings";
import {
  composeNoteMessage,
  type NoteComposerCard,
  noteCardMeta,
} from "@/modules/harness/lib/notes";
import { resolveWorkspacePath } from "@/modules/harness/lib/paths";
import {
  buildPlanPrompt,
  isProviderFailureText,
  planTurnPrompt,
} from "@/modules/harness/lib/plan";
import { preparePrompt } from "@/modules/harness/lib/promptPreparation";
import {
  providerAccountExists,
  selectedProviderAccountId,
  supportsProviderAccounts,
} from "@/modules/harness/lib/providerAccounts";
import { SECOND_OPINION_TITLE } from "@/modules/harness/lib/secondOpinion";
import {
  type Attachment,
  canReplaceSessionTitle,
  formatSessionTitle,
  HARNESS_LABEL,
  HARNESS_TITLE,
  type HarnessId,
  type PlanBuildTarget,
  type PlanStatus,
  type SecondOpinionMeta,
  type Session,
  sessionDisplayTitle,
  sessionWorkCwd,
  titleFromPrompt,
  type ComposerTurnOptions,
  type TurnIntent,
  type RuntimeMode,
} from "@/modules/harness/lib/session";
import {
  createEditedResendAttempt,
  createEditedResendCoordinator,
} from "@/modules/harness/lib/editLastTurn";
import { playCue } from "@/modules/harness/lib/sounds";
import { HarnessEventQueue } from "@/modules/harness/lib/harnessFlush";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyHarnessSessionDeltas,
  HarnessProjectReservedError,
  type HarnessSessionDelta,
} from "@/modules/harness/lib/harnessSessionEngineState";

export type HarnessSessionScheduling = "scheduled" | "immediate";
export type HarnessSessionEngineInputs = {
  initialSessions: () => Session[];
  isForeground: (id: string) => boolean;
  isRemoving: (id: string) => boolean;
  isSwitching: (id: string) => boolean;
  isProjectReserved?: (path: string) => boolean;
  reservationRevision?: object;
};

export function useHarnessSessionEngine(inputs: HarnessSessionEngineInputs) {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const [state, setState] = useState(() => {
    const sessions = inputs.initialSessions();
    return {
      sessions,
      owners: new Map(sessions.map((session) => [session.id, {}])),
    };
  });
  const { sessions } = state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const owners = useRef(state.owners);
  owners.current = state.owners;
  const eventOwners = useRef(new WeakMap<HarnessEvent, object>());
  const turnGen = useRef(new Map<string, number>());
  for (const id of turnGen.current.keys()) {
    if (!state.owners.has(id)) turnGen.current.delete(id);
  }
  const editedResends = useRef(createEditedResendCoordinator()).current;
  const queueDispatchingRef = useRef<Set<string>>(new Set());

  const applySessionDeltas = useCallback(
    (
      deltas: readonly HarnessSessionDelta[],
      scheduling: HarnessSessionScheduling = "scheduled",
    ) => {
      for (const delta of deltas)
        if (
          delta.kind === "admit" &&
          !sessionsRef.current.some(
            (session) => session.id === delta.session.id,
          ) &&
          inputsRef.current.isProjectReserved?.(delta.session.cwd)
        )
          throw new HarnessProjectReservedError();
      const apply = (previous: typeof state) => {
        let nextSessions = previous.sessions;
        let nextOwners = previous.owners;
        for (const delta of deltas) {
          const next = applyHarnessSessionDeltas(
            nextSessions,
            [delta],
            inputsRef.current.isProjectReserved,
          );
          if (next === nextSessions) continue;
          if (delta.kind === "remove" || delta.kind === "admit") {
            nextOwners = new Map(nextOwners);
            if (delta.kind === "remove") nextOwners.delete(delta.id);
            else nextOwners.set(delta.session.id, {});
          }
          nextSessions = next;
        }
        return nextSessions === previous.sessions
          ? previous
          : { sessions: nextSessions, owners: nextOwners };
      };
      if (scheduling === "immediate") {
        const next = apply(stateRef.current);
        if (next === stateRef.current) return;
        stateRef.current = next;
        sessionsRef.current = next.sessions;
        owners.current = next.owners;
        setState(next);
      } else
        setState((previous) => {
          try {
            return apply(previous);
          } catch (error) {
            if (error instanceof HarnessProjectReservedError) return previous;
            throw error;
          }
        });
    },
    [],
  );
  const updateSessions = useCallback(
    (
      ids: Iterable<string>,
      update: (session: Session) => Session,
      scheduling?: HarnessSessionScheduling,
    ) => {
      applySessionDeltas(
        [...new Set(ids)].map((id) => ({ kind: "update", id, update })),
        scheduling,
      );
    },
    [applySessionDeltas],
  );
  const updateSession = useCallback(
    (
      id: string,
      update: (session: Session) => Session,
      scheduling?: HarnessSessionScheduling,
    ) => {
      updateSessions([id], update, scheduling);
    },
    [updateSessions],
  );
  const admitSession = useCallback(
    (session: Session, scheduling?: HarnessSessionScheduling) => {
      applySessionDeltas([{ kind: "admit", session }], scheduling);
    },
    [applySessionDeltas],
  );
  const [harnessEvents] = useState(
    () =>
      new HarnessEventQueue(
        (id) => inputsRef.current.isForeground(id),
        (batches) => {
          updateSessions(
            batches.keys(),
            (session) => {
              const events = batches.get(session.id);
              return events
                ? events.reduce(
                    (current, event) =>
                      eventOwners.current.get(event) ===
                      owners.current.get(session.id)
                        ? applyHarnessEvent(current, event)
                        : current,
                    session,
                  )
                : session;
            },
            "immediate",
          );
          syncDockBadge(sessionsRef.current);
        },
      ),
  );
  const flushHarnessEvents = harnessEvents.flush;
  const flushForegroundHarnessEvents = harnessEvents.flushForeground;
  const enqueueHarnessEvent = useCallback(
    (id: string, event: HarnessEvent) => {
      const owner = owners.current.get(id);
      if (!owner) return;
      const queuedEvent = { ...event };
      eventOwners.current.set(queuedEvent, owner);
      harnessEvents.enqueue(id, queuedEvent);
    },
    [harnessEvents],
  );
  const cancelScheduledHarnessEvents = harnessEvents.cancelScheduled;
  const removeSession = useCallback(
    (id: string, scheduling?: HarnessSessionScheduling) => {
      flushHarnessEvents();
      applySessionDeltas([{ kind: "remove", id }], scheduling);
    },
    [applySessionDeltas, flushHarnessEvents],
  );
  const invalidateSessionTurn = useCallback((id: string) => {
    turnGen.current.set(id, (turnGen.current.get(id) ?? 0) + 1);
  }, []);
  const executionLifetime = useRef<object | null>(null);
  const isCurrentTurn = useCallback(
    (
      id: string,
      generation: number,
      owner: { session: object | undefined; lifetime: object | null },
    ) =>
      owner.session !== undefined &&
      owner.lifetime !== null &&
      executionLifetime.current === owner.lifetime &&
      owners.current.get(id) === owner.session &&
      turnGen.current.get(id) === generation,
    [],
  );
  useEffect(() => {
    const lifetime = {};
    executionLifetime.current = lifetime;
    return () => {
      if (executionLifetime.current === lifetime)
        executionLifetime.current = null;
      harnessEvents.cancelScheduled();
    };
  }, [harnessEvents]);

  const stopSessionForRemoval = useCallback(
    async (sessionId: string): Promise<Session | undefined> => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!open?.busy) return open;

      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      await Promise.all(
        sessionChildHarnesses(open).map((harness) =>
          cancelHarnessTurn(harness, sessionId).catch(() => undefined),
        ),
      );
      flushHarnessEvents();
      return sessionsRef.current.find((session) => session.id === sessionId);
    },
    [flushHarnessEvents],
  );

  const onModelChange = useCallback(
    (sessionId: string, harness: HarnessId, model: string) => {
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) return;
      const resolved = resolveModel(harness, model);
      saveRecentModelChoice(resolved.harness, resolved.id);
      if (current.modelSettings) {
        saveLastModelSettings(current.modelSettings, "fill");
      }
      const modelSettings = preferredModelSettings(
        resolved,
        current.modelSettings,
      );
      const plan = planComposerSwitch(current, harness);
      if (plan.kind === "empty") {
        void forgetHarnessSession(plan.forget, sessionId);
      }
      updateSessions([sessionId], (s) => {
        if (s.id !== sessionId) return s;
        const next = withHarnessChoice(s, harness, resolved.id, modelSettings);
        if (plan.kind === "arm") {
          return { ...next, pendingSwitch: plan.pending };
        }
        if (plan.kind === "revert") {
          return {
            ...next,
            pendingSwitch: undefined,
            ...(plan.restoreProviderSessionId
              ? { providerSessionId: plan.restoreProviderSessionId }
              : { providerSessionId: undefined }),
            ...(plan.restoreProviderAccountId
              ? { providerAccountId: plan.restoreProviderAccountId }
              : { providerAccountId: undefined }),
          };
        }
        if (plan.kind === "empty") {
          return { ...next, pendingSwitch: undefined };
        }
        return next;
      });
    },
    [updateSessions],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      saveLastModelSettings(modelSettings);
      updateSessions([sessionId], (s) =>
        s.id === sessionId ? { ...s, modelSettings } : s,
      );
    },
    [updateSessions],
  );

  const onRuntimeModeChange = useCallback(
    (sessionId: string, runtimeMode: RuntimeMode) => {
      updateSessions([sessionId], (s) =>
        s.id === sessionId ? { ...s, runtimeMode } : s,
      );
    },
    [updateSessions],
  );

  const onSubmit = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      options?: ComposerTurnOptions & {
        secondOpinion?: SecondOpinionMeta;
        followUpBehavior?: FollowUpBehavior;
        noteCard?: NoteComposerCard;
        handoffCard?: HandoffComposerCard;
        queuedMessageId?: string;
        intent?: TurnIntent;
        planBlockId?: string;
        buildTarget?: PlanBuildTarget;
      },
    ) => {
      if (
        inputsRef.current.isRemoving(sessionId) ||
        inputsRef.current.isSwitching(sessionId)
      )
        return;
      // Output already received belongs before the submitted user message.
      // Flush before reading the session too, since pending errors can settle it.
      flushHarnessEvents();
      const storedCurrent = sessionsRef.current.find((s) => s.id === sessionId);
      if (!storedCurrent) return;
      if (inputsRef.current.isProjectReserved?.(storedCurrent.cwd)) return;
      const current = options?.buildTarget
        ? withPlanBuildTarget(storedCurrent, options.buildTarget)
        : storedCurrent;
      const intent = options?.intent ?? "default";
      const approvedPlan = options?.planBlockId
        ? current.blocks.find(
            (block) =>
              block.id === options.planBlockId && block.role === "plan",
          )
        : undefined;
      if (intent === "build" && !approvedPlan?.text.trim()) return;
      if (options?.queuedMessageId) {
        const mode =
          options.followUpBehavior === "steer" ? "steer" : "dispatch";
        if (!queuedMessageForSubmit(current, options.queuedMessageId, mode)) {
          return;
        }
      }
      const noteCard =
        options && "noteCard" in options ? options.noteCard : current.noteCard;
      const handoffCard =
        options && "handoffCard" in options
          ? options.handoffCard
          : current.handoffCard;
      if (
        !text.trim() &&
        attachments.length === 0 &&
        !noteCard &&
        !handoffCard
      ) {
        return;
      }
      if (isPreparingHandoff(current)) return;
      const editedResend = options?.resendEdited
        ? createEditedResendAttempt(current, options.onResendRejected)
        : null;
      if (options?.resendEdited && !editedResend) return;
      if (editedResend && !editedResends.start(sessionId)) {
        editedResend.reject();
        return;
      }
      saveRecentModelChoice(current.harness, current.model);
      const workCwd = sessionWorkCwd(current);
      const accountProvider = supportsProviderAccounts(current.harness)
        ? current.harness
        : undefined;
      const providerAccountId = accountProvider
        ? (current.providerAccountId ??
          selectedProviderAccountId(accountProvider, current.cwd))
        : undefined;
      if (
        accountProvider &&
        providerAccountId &&
        !providerAccountExists(accountProvider, providerAccountId)
      ) {
        if (editedResend) editedResends.finish(sessionId);
        enqueueHarnessEvent(sessionId, {
          type: "session.error",
          message: t("harness.accounts.removedAccount"),
        });
        flushHarnessEvents();
        return;
      }
      const submittedText = intent === "build" ? "Build approved plan" : text;
      const harnessText = composeNoteMessage(noteCard, submittedText);

      const pendingSwitch =
        current.pendingSwitch && current.pendingSwitch.from !== current.harness
          ? current.pendingSwitch
          : null;

      if (current.busy && !pendingSwitch) {
        if (editedResend) editedResends.finish(sessionId);
        const followUpBehavior =
          intent === "plan"
            ? "queue"
            : (options?.followUpBehavior ?? loadFollowUpBehavior());
        if (followUpBehavior === "queue") {
          updateSessions([sessionId], (s) =>
            s.id === sessionId
              ? {
                  ...s,
                  inboxCard: undefined,
                  noteCard: undefined,
                  handoffCard: undefined,
                  queuedMessages: [
                    ...(s.queuedMessages ?? []),
                    {
                      id: crypto.randomUUID(),
                      text,
                      attachments,
                      noteCard,
                      handoffCard,
                      intent,
                    },
                  ],
                  queueStatus: s.queueStatus === "paused" ? "paused" : "active",
                }
              : s,
          );
          return;
        }
        if (
          !isLiveHarness(current.harness) ||
          !canSteerHarness(current.harness)
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: t("harness.chrome.cannotFollowUpMidTurn", {
              harness: current.harness,
            }),
          });
          flushHarnessEvents();
          return;
        }
        const steerOwner = {
          session: owners.current.get(sessionId),
          lifetime: executionLifetime.current,
        };
        const steerGeneration = turnGen.current.get(sessionId) ?? 0;
        const steerIsCurrent = () =>
          executionLifetime.current === steerOwner.lifetime &&
          owners.current.get(sessionId) === steerOwner.session &&
          (turnGen.current.get(sessionId) ?? 0) === steerGeneration;
        const visible = displayAttachments(attachments);
        const cards = userTurnCards(noteCard);
        updateSessions([sessionId], (s) => {
          if (s.id !== sessionId) return s;
          let next: Session = {
            ...s,
            inboxCard: undefined,
            noteCard: undefined,
            handoffCard: undefined,
          };
          if (options?.queuedMessageId) {
            next = dequeueQueuedMessage(next, options.queuedMessageId);
          }
          return appendSteerUser(next, submittedText, visible, cards);
        });
        void (async () => {
          try {
            const prepared = await prepareAttachments(attachments);
            const prompt = await preparePrompt(
              inboxAskPrompt(current.inboxAsk, harnessText),
              {
                harness: current.harness,
                cwd: workCwd,
              },
            );
            if (!steerIsCurrent()) return;
            await steerHarnessTurn({
              harness: current.harness,
              sessionId,
              cwd: workCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              providerAccountId,
              text: prompt,
              attachments: prepared,
            });
          } catch (error: unknown) {
            if (!steerIsCurrent()) return;
            const message =
              error instanceof Error
                ? error.message
                : `${current.harness} could not steer the active turn`;
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
            flushHarnessEvents();
          }
        })();
        return;
      }

      const turnOwner = {
        session: owners.current.get(sessionId),
        lifetime: executionLifetime.current,
      };
      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const initialBlocks = editedResend ? editedResend.blocks : current.blocks;
      const isFirstTurn = initialBlocks.length === 0;
      const placeholderTitle = canReplaceSessionTitle(
        current.title,
        current.harness,
        HARNESS_LABEL[current.harness],
      );
      const titleSeed =
        isFirstTurn &&
        !current.inboxCard &&
        !current.noteCard &&
        !current.inboxAsk &&
        placeholderTitle
          ? titleFromPrompt(submittedText, current.harness, attachments)
          : current.title;
      const visible = displayAttachments(attachments);
      const card =
        options?.secondOpinion ??
        (handoffCard ? handoffTurnCard(handoffCard) : undefined);
      const visibleText =
        card?.kind === "handoff"
          ? submittedText
          : card
            ? SECOND_OPINION_TITLE
            : submittedText;
      const cards = userTurnCards(noteCard, card);
      const live = isLiveHarness(current.harness);
      const queuedHandoff =
        live && !pendingSwitch ? pendingHandoff(current) : null;

      const commitSubmittedTurn = () => {
        updateSessions([sessionId], (s) => {
          if (s.id !== sessionId) return s;
          const target = editedResend ? editedResend.replace(s) : s;
          const selected = options?.buildTarget
            ? withPlanBuildTarget(target, options.buildTarget)
            : target;
          const titled = isFirstTurn ? titleSeed : selected.title;
          let next: Session = {
            ...selected,
            providerAccountId,
            inboxCard: undefined,
            noteCard: undefined,
            handoffCard: undefined,
          };
          if (approvedPlan && intent === "build") {
            next = {
              ...next,
              blocks: next.blocks.map((block) =>
                block.id === approvedPlan.id
                  ? {
                      ...block,
                      plan: {
                        ...(block.plan ?? { status: "ready" as const }),
                        status: "building" as const,
                        approvedText: block.text,
                      },
                    }
                  : block,
              ),
            };
          }
          if (options?.queuedMessageId) {
            next = dequeueQueuedMessage(next, options.queuedMessageId);
          }
          if (!live) {
            return {
              ...next,
              title: titled,
              pendingSwitch: undefined,
              busy: false,
              blocks: [
                ...next.blocks,
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  text: visibleText,
                  ...(visible.length > 0 ? { attachments: visible } : {}),
                  ...cards,
                },
                {
                  id: crypto.randomUUID(),
                  role: "system",
                  text: t("harness.chrome.providerNotConnected", {
                    harness: next.harness,
                  }),
                },
              ],
            };
          }
          if (pendingSwitch) {
            const sealed = stopStreaming({
              ...next,
              title: titled,
              pendingSwitch: undefined,
            });
            return appendUser(
              appendPreparingHandoff(sealed, pendingSwitch.from, next.harness),
              visibleText,
              visible,
              cards,
            );
          }
          return appendUser(
            { ...next, title: titled },
            visibleText,
            visible,
            cards,
          );
        });
      };

      if (!options?.resendEdited) {
        flushSync(commitSubmittedTurn);
      } else if (editedResend && canRewindHarnessLastTurn(current.harness)) {
        updateSessions([sessionId], (s) =>
          s.id === sessionId ? { ...s, busy: true } : s,
        );
      }

      if (isFirstTurn && live && placeholderTitle && !current.inboxAsk) {
        void generateHarnessTitle(current.harness, {
          sessionId,
          cwd: workCwd,
          message:
            harnessText || attachments.map((file) => file.name).join(", "),
          providerAccountId,
        })
          .then((generated) => {
            if (!generated?.title || !isCurrentTurn(sessionId, gen, turnOwner))
              return;
            updateSessions([sessionId], (s) => {
              if (s.id !== sessionId) return s;
              if (!canReplaceSessionTitle(s.title, s.harness, titleSeed)) {
                return s;
              }
              return {
                ...s,
                title: formatSessionTitle(s.harness, generated.title),
              };
            });
          })
          .catch(() => undefined);
      }

      if (!live) {
        if (pendingSwitch) {
          void forgetHarnessSession(pendingSwitch.from, sessionId);
        }
        return;
      }

      void (async () => {
        let wrap = handoffCard
          ? {
              from: handoffCard.from,
              to: current.harness,
              text: handoffCard.brief,
            }
          : queuedHandoff;
        const revealHandoff = (brief: string) => {
          updateSessions([sessionId], (s) => {
            if (s.id !== sessionId || !isPreparingHandoff(s)) return s;
            return { ...completeHandoff(s, brief), busy: true };
          });
        };
        const planEventKey = `turn:${gen}`;
        let nativePlanSeen = false;
        let providerFailureSeen = false;
        const routePlanEvent = (event: HarnessEvent): HarnessEvent | null => {
          if (event.type === "session.error") providerFailureSeen = true;
          if (intent !== "plan") return event;
          if (event.type === "plan") {
            nativePlanSeen = true;
            return {
              ...event,
              key: planEventKey,
            };
          }
          return event;
        };

        const pendingEditedEvents: HarnessEvent[] = [];
        const routeTurnEvent = (event: HarnessEvent) => {
          if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
          if (editedResend && !editedResend.isAccepted()) {
            pendingEditedEvents.push(event);
            return;
          }
          if (
            wrap &&
            (event.type === "session.started" ||
              event.type === "session.providerBound")
          ) {
            revealHandoff(wrap.text);
          }
          nudgeOpenEditors(event, workCwd);
          trackSessionEdits(sessionId, workCwd, event);
          const routed = routePlanEvent(event);
          if (routed) enqueueHarnessEvent(sessionId, routed);
        };

        const acceptEditedResend = () => {
          if (
            !isCurrentTurn(sessionId, gen, turnOwner) ||
            !editedResend ||
            editedResend.isAccepted()
          )
            return;
          editedResend.markAccepted();
          flushSync(commitSubmittedTurn);
          for (const event of pendingEditedEvents.splice(0)) {
            routeTurnEvent(event);
          }
        };

        const recoverEditedResend = () => {
          if (!editedResend) return;
          flushSync(() => {
            updateSessions([sessionId], (s) =>
              s.id === sessionId ? editedResend.recoverAfterFailure(s) : s,
            );
          });
          editedResend.reject();
        };

        let buildSucceeded = false;
        try {
          if (editedResend && canRewindHarnessLastTurn(current.harness)) {
            await rewindHarnessLastTurn({
              harness: current.harness,
              sessionId,
              cwd: workCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              providerAccountId,
              runtimeMode: current.runtimeMode,
              providerTurnId: editedResend.providerTurnId,
              onEvent: routeTurnEvent,
            });
            editedResend.markProviderRewound();
          }

          if (pendingSwitch) {
            if (current.busy) {
              await cancelHarnessTurn(pendingSwitch.from, sessionId);
            }
            let agentText = "";
            if (
              shouldAskOutgoingAgent(current) &&
              isLiveHarness(pendingSwitch.from)
            ) {
              agentText = await requestOutgoingHandoff({
                harness: pendingSwitch.from,
                sessionId,
                cwd: workCwd,
                model: pendingSwitch.fromModel,
                modelSettings: pendingSwitch.fromSettings,
                providerAccountId: pendingSwitch.fromProviderAccountId,
                userRequest: text,
              });
            }
            if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
            const latest = sessionsRef.current.find((s) => s.id === sessionId);
            const brief = chooseHandoffBrief(
              agentText,
              buildDeterministicHandoff(latest ?? current, text),
            );
            await forgetHarnessSession(pendingSwitch.from, sessionId);
            if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
            wrap = {
              from: pendingSwitch.from,
              to: current.harness,
              text: brief,
            };
          }

          if (!current.inboxAsk) {
            await beginSessionTurn(sessionId, workCwd).catch(() => undefined);
          }
          if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
          const prepared = await prepareAttachments(attachments);
          const prompt =
            intent === "build" && approvedPlan
              ? buildPlanPrompt(approvedPlan.text)
              : await preparePrompt(
                  inboxAskPrompt(current.inboxAsk, harnessText),
                  {
                    harness: current.harness,
                    cwd: workCwd,
                  },
                );
          if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
          const turnPrompt =
            intent === "plan" ? planTurnPrompt(prompt) : prompt;
          const earlier = queuedHandoff
            ? userMessagesAfterHandoff(current)
            : [];
          await sendHarnessTurn({
            harness: current.harness,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            providerAccountId,
            runtimeMode: current.runtimeMode,
            intent,
            text: wrap
              ? wrapHandoffPrompt(
                  wrap.text,
                  wrap.from,
                  turnPrompt.trim() || CONTINUE_PROMPT,
                  earlier,
                )
              : turnPrompt,
            attachments: prepared,
            onAccepted: acceptEditedResend,
            onEvent: routeTurnEvent,
          });
          if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
          if (wrap) {
            const completedBrief = wrap.text;
            updateSessions([sessionId], (s) => {
              if (s.id !== sessionId) return s;
              const ready = isPreparingHandoff(s)
                ? completeHandoff(s, completedBrief)
                : s;
              return consumeHandoff(ready);
            });
          }
          buildSucceeded = true;
        } catch (error: unknown) {
          if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
          recoverEditedResend();
          if (pendingSwitch || wrap) {
            const brief =
              wrap?.text ?? buildDeterministicHandoff(current, text);
            updateSessions([sessionId], (s) => {
              if (s.id !== sessionId || !isPreparingHandoff(s)) return s;
              return consumeHandoff(completeHandoff(s, brief));
            });
          }
          const message =
            error instanceof Error
              ? error.message
              : String(error || `${current.harness} adapter failed`);
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message,
          });
        } finally {
          if (editedResend) {
            editedResends.finish(sessionId);
          }
          if (isCurrentTurn(sessionId, gen, turnOwner)) {
            flushHarnessEvents();
            updateSessions([sessionId], (s) => {
              if (s.id !== sessionId) return s;
              const stopped = stopStreaming(s);
              const providerFailed =
                providerFailureSeen ||
                isProviderFailureText(lastAssistantTextInTurn(stopped));
              const finalized =
                intent === "plan" && !nativePlanSeen && !providerFailed
                  ? promoteLastAssistantToPlan(stopped, planEventKey)
                  : stopped;
              return approvedPlan && intent === "build"
                ? withPlanStatus(
                    finalized,
                    approvedPlan.id,
                    buildSucceeded && !providerFailed ? "built" : "ready",
                  )
                : finalized;
            });
            playCue("turnFinished");
            await syncSessionCheckpoint(sessionId, workCwd).catch(
              () => undefined,
            );
            notifyReviewChanged(sessionId);
            notifyGitChanged();
            nudgeWorkspace(workCwd);
            nudgeWatchedFiles();
            window.setTimeout(() => nudgeWatchedFiles(), 150);
          }
        }
      })();
    },
    [
      enqueueHarnessEvent,
      flushHarnessEvents,
      updateSessions,
      isCurrentTurn,
      editedResends.start,
      editedResends.finish,
    ],
  );

  const onUpdatePlan = useCallback(
    (sessionId: string, blockId: string, text: string) => {
      updateSessions([sessionId], (session) => {
        if (session.id !== sessionId || session.busy) return session;
        return {
          ...session,
          blocks: session.blocks.map((block) => {
            if (
              block.id !== blockId ||
              block.role !== "plan" ||
              block.plan?.status === "streaming" ||
              block.plan?.status === "building" ||
              block.plan?.status === "built"
            ) {
              return block;
            }
            const originalText = block.plan?.originalText ?? block.text;
            return {
              ...block,
              text,
              plan: {
                ...(block.plan ?? { status: "ready" as const }),
                status: "ready" as const,
                originalText,
                edited: text !== originalText,
              },
            };
          }),
        };
      });
    },
    [updateSessions],
  );

  const onBuildPlan = useCallback(
    (sessionId: string, blockId: string, target?: PlanBuildTarget) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (
        !session ||
        session.busy ||
        block?.role !== "plan" ||
        !block.text.trim() ||
        block.plan?.status === "streaming" ||
        block.plan?.status === "building" ||
        block.plan?.status === "built"
      ) {
        return;
      }
      if (target && session.modelSettings) {
        saveLastModelSettings(session.modelSettings, "fill");
      }
      onSubmit(sessionId, "Build approved plan", [], {
        intent: "build",
        planBlockId: blockId,
        buildTarget: target,
      });
    },
    [onSubmit],
  );

  const autoContinueKey = sessions
    .filter(
      (session) => canAutoContinue(session) && isLiveHarness(session.harness),
    )
    .map((session) => session.id)
    .join("\n");
  const reservationRevision = inputs.reservationRevision;

  useEffect(() => {
    if (!autoContinueKey) return;
    const ids = autoContinueKey.split("\n");
    // Delay past React StrictMode's dev remount so Continue is not claimed
    // against a discarded tree (sessionStorage also survives Vite reloads).
    const timer = window.setTimeout(() => {
      if (inputsRef.current.reservationRevision !== reservationRevision) return;
      for (const id of ids) {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (
          !session ||
          !canAutoContinue(session) ||
          !isLiveHarness(session.harness)
        ) {
          continue;
        }
        onSubmit(id, CONTINUE_PROMPT);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoContinueKey, onSubmit, reservationRevision]);

  useEffect(() => {
    const timers: number[] = [];
    const scheduled = new Set<string>();
    for (const session of sessions) {
      const queued = session.queuedMessages ?? [];
      if (session.busy || queued.length === 0) continue;

      if (session.queueStatus === "resuming") {
        updateSessions([session.id], (entry) =>
          entry.id === session.id ? { ...entry, queueStatus: "active" } : entry,
        );
        continue;
      }
      if (
        !canDispatchQueuedHead(session) ||
        queueDispatchingRef.current.has(session.id)
      ) {
        continue;
      }

      const next = queued[0];
      if (!next) continue;
      queueDispatchingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          queueDispatchingRef.current.delete(session.id);
          if (inputsRef.current.reservationRevision !== reservationRevision)
            return;
          const latest = sessionsRef.current.find(
            (entry) => entry.id === session.id,
          );
          const head = latest?.queuedMessages?.[0];
          if (
            !latest ||
            !head ||
            head.id !== next.id ||
            !canDispatchQueuedHead(latest)
          ) {
            return;
          }
          onSubmit(session.id, head.text, head.attachments, {
            queuedMessageId: head.id,
            noteCard: head.noteCard,
            handoffCard: head.handoffCard,
            intent: head.intent,
          });
        }, 0),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) queueDispatchingRef.current.delete(id);
    };
  }, [onSubmit, sessions, updateSessions, reservationRevision]);

  const onDeleteQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      updateSessions([sessionId], (session) =>
        session.id === sessionId
          ? dequeueQueuedMessage(session, messageId)
          : session,
      );
    },
    [updateSessions],
  );

  const onQueuedMessageEditingChange = useCallback(
    (sessionId: string, messageId?: string) => {
      updateSessions([sessionId], (session) =>
        session.id === sessionId
          ? { ...session, editingQueuedMessageId: messageId }
          : session,
      );
    },
    [updateSessions],
  );

  const onEditQueuedMessage = useCallback(
    (sessionId: string, messageId: string, text: string) => {
      updateSessions([sessionId], (session) =>
        session.id === sessionId
          ? {
              ...session,
              queuedMessages: session.queuedMessages?.map((message) =>
                message.id === messageId ? { ...message, text } : message,
              ),
              editingQueuedMessageId: undefined,
            }
          : session,
      );
    },
    [updateSessions],
  );

  const onSteerQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      const message = session
        ? queuedMessageForSubmit(session, messageId, "steer")
        : undefined;
      if (!session || !message) return;
      onSubmit(sessionId, message.text, message.attachments, {
        followUpBehavior: "steer",
        queuedMessageId: message.id,
        noteCard: message.noteCard,
        handoffCard: message.handoffCard,
      });
    },
    [onSubmit],
  );

  const onResumeQueue = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      if (
        session?.queueStatus !== "paused" ||
        !session.queuedMessages?.length
      ) {
        return;
      }
      updateSessions([sessionId], (entry) =>
        entry.id === sessionId ? { ...entry, queueStatus: "resuming" } : entry,
      );
    },
    [updateSessions],
  );

  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (
        !current ||
        current.busy ||
        inputsRef.current.isProjectReserved?.(current.cwd)
      )
        return false;
      if (!canCompactHarnessContext(current.harness)) {
        updateSession(
          sessionId,
          (session: Session) =>
            session.id === sessionId
              ? applyHarnessEvent(session, {
                  type: "status",
                  text: t("harness.chrome.manualCompactionUnsupported", {
                    harness: HARNESS_TITLE[current.harness as HarnessId],
                  }),
                })
              : session,
          "immediate",
        );
        syncDockBadge(sessionsRef.current);
        return true;
      }

      const turnOwner = {
        session: owners.current.get(sessionId),
        lifetime: executionLifetime.current,
      };
      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const workCwd = sessionWorkCwd(current);
      updateSession(
        sessionId,
        (session: Session) =>
          session.id === sessionId
            ? applyHarnessEvent(
                { ...session, busy: true },
                { type: "status", text: t("harness.chrome.compactingContext") },
              )
            : session,
        "immediate",
      );
      syncDockBadge(sessionsRef.current);

      void (async () => {
        try {
          await compactHarnessContext({
            harness: current.harness,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            providerAccountId: supportsProviderAccounts(current.harness)
              ? (current.providerAccountId ??
                selectedProviderAccountId(current.harness, current.cwd))
              : undefined,
            runtimeMode: current.runtimeMode,
            onEvent: (event) => {
              if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
              enqueueHarnessEvent(sessionId, event);
            },
          });
          if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: t("harness.chrome.compactedContext"),
          });
        } catch (error: unknown) {
          if (!isCurrentTurn(sessionId, gen, turnOwner)) return;
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message:
              error instanceof Error
                ? error.message
                : `${current.harness} could not compact this context`,
          });
        } finally {
          // Guarded with a condition rather than an early return: a `return`
          // here would discard whatever the try or catch was propagating.
          if (isCurrentTurn(sessionId, gen, turnOwner)) {
            flushHarnessEvents();
            updateSession(
              sessionId,
              (session: Session) =>
                session.id === sessionId
                  ? { ...session, busy: false }
                  : session,
              "immediate",
            );
            syncDockBadge(sessionsRef.current);
          }
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents, updateSession, isCurrentTurn],
  );

  const onStop = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      if (session) {
        for (const id of sessionChildHarnesses(session)) {
          void cancelHarnessTurn(id, sessionId);
        }
      }
      updateSessions([sessionId], (s) => {
        if (s.id !== sessionId) return s;
        const stopped = stopStreaming(s);
        const completed = isPreparingHandoff(stopped)
          ? consumeHandoff(
              completeHandoff(stopped, buildDeterministicHandoff(stopped)),
            )
          : stopped;
        return completed.queuedMessages?.length
          ? { ...completed, queueStatus: "paused" }
          : completed;
      });
      if (session) {
        void syncSessionCheckpoint(sessionId, sessionWorkCwd(session))
          .catch(() => undefined)
          .then(() => notifyReviewChanged(sessionId));
        nudgeWorkspace(sessionWorkCwd(session));
        notifyGitChanged();
        nudgeWatchedFiles();
        window.setTimeout(() => nudgeWatchedFiles(), 150);
      } else {
        notifyReviewChanged(sessionId);
      }
    },
    [flushHarnessEvents, updateSessions],
  );

  const onApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      respondHarnessApproval(session.harness, sessionId, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      respondHarnessQuestion(session.harness, sessionId, requestId, reply);
    },
    [],
  );

  const onQuestionInteraction = useCallback(
    (sessionId: string, requestId: number) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session)
        keepHarnessQuestionOpen(session.harness, sessionId, requestId);
    },
    [],
  );

  const captureSessionLifetime = useCallback((id: string) => {
    const owner = owners.current.get(id);
    const lifetime = executionLifetime.current;
    return () =>
      lifetime !== null &&
      executionLifetime.current === lifetime &&
      owner !== undefined &&
      owners.current.get(id) === owner;
  }, []);

  return {
    sessions,
    sessionsRef: sessionsRef as Readonly<{ current: Session[] }>,
    captureSessionLifetime,
    readSession: (id: string) =>
      sessionsRef.current.find((session) => session.id === id),
    applySessionDeltas,
    updateSession,
    updateSessions,
    admitSession,
    removeSession,
    invalidateSessionTurn,
    onModelChange,
    onModelSettingsChange,
    onRuntimeModeChange,
    flushHarnessEvents,
    flushForegroundHarnessEvents,
    cancelScheduledHarnessEvents,
    onSubmit,
    onUpdatePlan,
    onBuildPlan,
    onDeleteQueuedMessage,
    onQueuedMessageEditingChange,
    onEditQueuedMessage,
    onSteerQueuedMessage,
    onResumeQueue,
    onCompactContext,
    onStop,
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
    stopSessionForRemoval,
  };
}

function userTurnCards(
  noteCard: NoteComposerCard | undefined,
  secondOpinion?: SecondOpinionMeta,
) {
  if (!noteCard && !secondOpinion) return undefined;
  return {
    ...(secondOpinion ? { secondOpinion } : {}),
    ...(noteCard ? { noteCard: noteCardMeta(noteCard) } : {}),
  };
}

function withHarnessChoice(
  session: Session,
  harness: HarnessId,
  model: string,
  modelSettings: Record<string, string>,
): Session {
  return {
    ...session,
    harness,
    model,
    modelSettings,
    title:
      session.blocks.length === 0
        ? HARNESS_LABEL[harness]
        : formatSessionTitle(
            harness,
            sessionDisplayTitle(session.title, session.harness),
          ),
    ...(session.model === model
      ? {}
      : { context: dropContextWindow(session.context) }),
    ...(session.harness === harness
      ? {}
      : { providerSessionId: undefined, providerAccountId: undefined }),
  };
}

function withPlanBuildTarget(
  session: Session,
  target: PlanBuildTarget,
): Session {
  const resolved = resolveModel(target.harness, target.model);
  const modelSettings = mergeModelSettings(resolved, target.modelSettings);
  const plan = planComposerSwitch(session, target.harness);
  const next = withHarnessChoice(
    session,
    target.harness,
    resolved.id,
    modelSettings,
  );

  if (plan.kind === "arm") {
    return { ...next, pendingSwitch: plan.pending };
  }
  if (plan.kind === "revert") {
    return {
      ...next,
      pendingSwitch: undefined,
      ...(plan.restoreProviderSessionId
        ? { providerSessionId: plan.restoreProviderSessionId }
        : { providerSessionId: undefined }),
      ...(plan.restoreProviderAccountId
        ? { providerAccountId: plan.restoreProviderAccountId }
        : { providerAccountId: undefined }),
    };
  }
  if (plan.kind === "empty") {
    return { ...next, pendingSwitch: undefined };
  }
  return next;
}

function withPlanStatus(
  session: Session,
  blockId: string,
  status: PlanStatus,
): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === blockId && block.role === "plan"
        ? {
            ...block,
            plan: { ...(block.plan ?? { status: "ready" as const }), status },
          }
        : block,
    ),
  };
}

function lastAssistantTextInTurn(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

function trackSessionEdits(
  sessionId: string,
  cwd: string,
  event: HarnessEvent,
) {
  if (event.type !== "tool.updated") return;
  const isEdit = isEditTool(event.kind, event.title, event.preview);
  const path = event.preview?.path;

  if (
    isEdit &&
    path &&
    cwd !== "~" &&
    (event.status === "in_progress" || event.status === "pending")
  ) {
    void prepareSessionCheckpoint(sessionId, cwd, [path]).catch(
      () => undefined,
    );
    return;
  }

  const completed = event.status === "completed" || event.status === "success";
  if (!completed) return;
  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    void syncSessionCheckpoint(sessionId, cwd)
      .catch(() => undefined)
      .then(() => notifyReviewChanged(sessionId));
    return;
  }
  if (!isEdit) return;
  if (path && cwd !== "~") {
    void captureSessionCheckpoint(sessionId, cwd, [path])
      .catch(() => undefined)
      .then(() => notifyReviewChanged(sessionId));
    return;
  }
  notifyReviewChanged(sessionId);
}

function nudgeWorkspace(cwd?: string) {
  invalidateProjectFiles(cwd);
  notifyDirsChanged();
}

function nudgeOpenEditors(event: HarnessEvent, cwd: string) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";

  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    if (!completed) return;
    nudgeWatchedFiles();
    window.setTimeout(() => nudgeWatchedFiles(), 150);
    notifyGitChanged();
    nudgeWorkspace(cwd);
    window.setTimeout(() => nudgeWorkspace(cwd), 150);
    return;
  }

  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const raw = event.preview?.path;
  const resolved = raw ? (resolveWorkspacePath(raw, cwd) ?? raw) : undefined;
  if (resolved) {
    nudgeWatchedFiles([resolved]);
  } else if (completed) {
    nudgeWatchedFiles();
  }
  if (completed) {
    window.setTimeout(() => nudgeWatchedFiles(), 150);
    notifyGitChanged();
    nudgeWorkspace(cwd);
  }
}
