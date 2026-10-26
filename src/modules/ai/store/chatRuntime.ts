import { Chat, type UIMessage } from "@ai-sdk/react";
import {
  type ChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { getModel, providerNeedsKey, type ModelId } from "../config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { BUILTIN_AGENTS } from "../lib/agents";
import { isAiRuntimeAvailable } from "../lib/runtimeAvailability";
import {
  registerChatFileTools,
  retireChatFileTools,
  retireChatToolApproval,
} from "@/modules/ai/lib/chatFileTools";
import { useAgentsStore } from "./agentsStore";
import { usePlanStore } from "./planStore";
import { createContextAwareTransport } from "../lib/transport";
import type { ToolContext } from "../tools/tools";
import {
  chats,
  getActiveProviderKey,
  seedMessages,
  touchChat,
  useChatStore,
} from "./chatStore";

function makeChat(sessionId: string): Chat<UIMessage> {
  const readCache = new Map<string, { size: number; hash: number }>();
  const toolContext: ToolContext = {
    getFileRootContext: () =>
      useChatStore.getState().live.getFileRootContext?.() ?? null,
    getFileContext: () =>
      useChatStore.getState().live.getFileContext?.() ?? null,
    getCwd: () => useChatStore.getState().live.getCwd(),
    getWorkspaceRoot: () => useChatStore.getState().live.getWorkspaceRoot(),
    getActiveFile: () => useChatStore.getState().live.getActiveFile(),
    getEditorBuffers: () => useChatStore.getState().live.getEditorBuffers(),
    getWorkspaceDiagnostics: () =>
      useChatStore.getState().live.getWorkspaceDiagnostics(),
    getModelId: () => useChatStore.getState().selectedModelId,
    getTerminalContext: () => useChatStore.getState().live.getTerminalContext(),
    isActiveTerminalPrivate: () =>
      useChatStore.getState().live.isActiveTerminalPrivate(),
    injectIntoActivePty: (text) =>
      useChatStore.getState().live.injectIntoActivePty(text),
    openPreview: (url) => useChatStore.getState().live.openPreview(url),
    spawnAgent: (prompt) =>
      useChatStore.getState().live.spawnManagedAgent(prompt, sessionId),
    readAgentOutput: (leafId) =>
      useChatStore.getState().live.readLeafBuffer(leafId),
    readCache,
    getSessionId: () => sessionId,
    onAgentStep: (step) =>
      useChatStore.getState().patchAgentMeta({ step }, chat),
  };

  const transport = createContextAwareTransport({
    isAvailable: isAiRuntimeAvailable,
    getKeys: () => useChatStore.getState().apiKeys,
    toolContext,
    getModelId: () => useChatStore.getState().selectedModelId,
    getCustomInstructions: () =>
      usePreferencesStore.getState().customInstructions,
    getAgentPersona: () => {
      const { activeId, customAgents } = useAgentsStore.getState();
      const all = [...BUILTIN_AGENTS, ...customAgents];
      const a = all.find((x) => x.id === activeId) ?? BUILTIN_AGENTS[0];
      return { name: a.name, instructions: a.instructions };
    },
    getLive: () => {
      const live = useChatStore.getState().live;
      return {
        cwd: live.getCwd(),
        terminalPrivate: live.isActiveTerminalPrivate(),
        workspaceRoot: live.getWorkspaceRoot(),
        activeFile: live.getActiveFile(),
      };
    },
    getLanguage: () => usePreferencesStore.getState().language ?? "en",
    getPlanMode: () => usePlanStore.getState().active,
    getLmstudioBaseURL: () => usePreferencesStore.getState().lmstudioBaseURL,
    getLmstudioModelId: () => usePreferencesStore.getState().lmstudioModelId,
    getMlxBaseURL: () => usePreferencesStore.getState().mlxBaseURL,
    getMlxModelId: () => usePreferencesStore.getState().mlxModelId,
    getOllamaBaseURL: () => usePreferencesStore.getState().ollamaBaseURL,
    getOllamaModelId: () => usePreferencesStore.getState().ollamaModelId,
    getOpenaiCompatibleBaseURL: () =>
      usePreferencesStore.getState().openaiCompatibleBaseURL,
    getOpenaiCompatibleModelId: () =>
      usePreferencesStore.getState().openaiCompatibleModelId,
    getOpenaiCompatibleContextLimit: () =>
      usePreferencesStore.getState().openaiCompatibleContextLimit,
    getOpenrouterModelId: () =>
      usePreferencesStore.getState().openrouterModelId,
    getCustomEndpoints: () => usePreferencesStore.getState().customEndpoints,
    getCustomEndpointKeys: () => useChatStore.getState().customEndpointKeys,
    onStep: (step) => {
      useChatStore.getState().patchAgentMeta({ step }, chat);
    },
    onCompact: (info) => {
      useChatStore.getState().patchAgentMeta(
        {
          compactionNotice: { droppedCount: info.droppedCount, at: Date.now() },
        },
        chat,
      );
    },
    onFinishMeta: (info) => {
      useChatStore
        .getState()
        .patchAgentMeta({ hitStepCap: info.hitStepCap }, chat);
    },
    onUsage: (delta) => {
      useChatStore.getState().patchAgentMeta(
        (current) => ({
          tokens: {
            inputTokens: current.tokens.inputTokens + delta.inputTokens,
            outputTokens: current.tokens.outputTokens + delta.outputTokens,
            cachedInputTokens:
              current.tokens.cachedInputTokens + delta.cachedInputTokens,
          },
          lastInputTokens: delta.lastInputTokens,
          lastCachedTokens: delta.lastCachedTokens,
        }),
        chat,
      );
    },
  }) as unknown as ChatTransport<UIMessage>;

  const initialMessages = seedMessages.get(sessionId);
  seedMessages.delete(sessionId);

  const chat = new Chat<UIMessage>({
    id: sessionId,
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (e) => {
      useChatStore.getState().patchAgentMeta(
        {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        },
        chat,
      );
    },
  });
  registerChatFileTools(chat, toolContext);
  const stop = chat.stop;
  chat.stop = () => {
    retireChatFileTools(chat);
    return stop();
  };
  const respond = chat.addToolApprovalResponse;
  chat.addToolApprovalResponse = (response) => {
    if (!response.approved) retireChatToolApproval(chat, response.id);
    return respond(response);
  };
  return chat;
}

export function getOrCreateChat(sessionId: string): Chat<UIMessage> {
  const existing = chats.get(sessionId);
  if (existing) {
    touchChat(sessionId, existing);
    return existing;
  }
  const c = makeChat(sessionId);
  touchChat(sessionId, c);
  return c;
}

export async function sendMessage(
  text: string,
  owner?: Chat<UIMessage>,
): Promise<boolean> {
  const state = useChatStore.getState();
  const sessionId = owner?.id ?? state.activeSessionId;
  if (!sessionId) return false;
  if (owner && chats.get(sessionId) !== owner) return false;
  if (owner && (owner.status === "submitted" || owner.status === "streaming"))
    return false;
  if (
    providerNeedsKey(getModel(state.selectedModelId as ModelId).provider) &&
    !getActiveProviderKey()
  )
    return false;
  const c = owner ?? getOrCreateChat(sessionId);
  await c.sendMessage({ text });
  return true;
}
