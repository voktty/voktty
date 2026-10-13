import { useEffect } from "react";
import { useTranslation } from "@/modules/i18n";
import { AiSidebarPanel } from "@/modules/ai/components/AiSidebarPanel";
import { AiComposerInput } from "@/modules/ai/components/AiComposerInput";
import { AiInputBarConnect } from "@/modules/ai/components/AiInputBar";
import { ChipsRow } from "@/modules/ai/components/ChipsRow";
import { useComposer } from "@/modules/ai/lib/composer";
import { registerEmbeddedChat } from "@/modules/ai/lib/embeddedChat";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useSettingsModalStore } from "@/modules/settings/settingsModalStore";

export function HarnessNativeAiView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const available = useAiAvailable();
  const composer = useComposer();
  useEffect(() => {
    const release = registerEmbeddedChat();
    const chat = useChatStore.getState();
    chat.closeMini();
    chat.closePanel();
    chat.markChatRead();
    return release;
  }, []);

  if (!available) {
    return (
      <div className="flex h-full flex-col justify-center bg-background">
        <p className="px-6 py-4 text-center text-sm text-muted-foreground">
          {t("settings.models.aiHealthRequired")}
        </p>
        <AiInputBarConnect
          onAdd={() => useSettingsModalStore.getState().openSettings("models")}
        />
      </div>
    );
  }

  return (
    <AiSidebarPanel
      onClose={onClose}
      composer={
        <div
          className="flex shrink-0 flex-col gap-2 border-t border-border px-4 py-3"
          data-ai-input-bar
        >
          <ChipsRow
            files={composer.files}
            onRemoveFile={composer.removeFile}
            snippets={composer.pickedSnippets}
            onRemoveSnippet={composer.removeSnippet}
            commands={composer.pickedCommands}
            onRemoveCommand={composer.removeCommand}
          />
          <AiComposerInput />
        </div>
      }
    />
  );
}
