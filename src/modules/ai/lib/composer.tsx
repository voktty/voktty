import type { WorkspaceEnv } from "@/modules/workspace";
import { t } from "@/modules/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWhisperRecording } from "../hooks/useWhisperRecording";
import { expandSnippetTokens, type Snippet } from "../lib/snippets";
import { useChatStore } from "../store/chatStore";
import { useChatActionOwner } from "@/modules/ai/lib/useChatActionOwner";
import { readBrowserAttachments } from "@/modules/ai/lib/browserAttachments";
import { readPathAttachment } from "@/modules/ai/lib/pathAttachments";
import { FILE_ATTACHMENT_EVENT, takeFileAttachmentRequest } from "@/modules/ai/lib/fileAttachmentRequest";
export { MAX_TEXT_INLINE } from "@/modules/ai/lib/browserAttachments";
import { useSnippetsStore } from "../store/snippetsStore";
import { type SlashCommandMeta, tryRunSlashCommand } from "./slashCommands";
import {
  useLiveComponentStore,
  formatComponentPromptDirective,
} from "@/modules/preview";

export type FileAttachment = {
  id: string;
  name: string;
  kind: "image" | "text" | "selection";
  mediaType: string;
  url?: string;
  text?: string;
  size: number;
  /** For kind === "selection": which surface it came from. */
  source?: "terminal" | "editor";
};

type MessagePart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; url: string; filename?: string };

export const ACCEPTED_FILES =
  "image/*,.txt,.md,.json,.yaml,.yml,.toml,.sh,.zsh,.bash,.py,.js,.jsx,.ts,.tsx,.rs,.go,.java,.c,.cpp,.h,.hpp,.html,.css,.csv,.log,.env,.config,.conf,.ini,Dockerfile,.dockerfile";

type Voice = ReturnType<typeof useWhisperRecording>;

type ComposerCtx = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  files: FileAttachment[];
  addFiles: (list: FileList | null) => Promise<void>;
  attachFileByPath: (
    path: string,
    workspace: WorkspaceEnv,
    isCurrent?: () => boolean,
  ) => Promise<boolean>;
  attachTextFile: (
    attachment: {
      id: string;
      name: string;
      text: string;
      size: number;
    },
    isCurrent?: () => boolean,
  ) => boolean;
  removeFile: (id: string) => void;
  pickedSnippets: Snippet[];
  addSnippet: (s: Snippet) => void;
  removeSnippet: (id: string) => void;
  pickedCommands: SlashCommandMeta[];
  addCommand: (c: SlashCommandMeta) => void;
  removeCommand: (name: string) => void;
  isBusy: boolean;
  submit: () => void;
  stop: () => void;
  voice: Voice;
  canSend: boolean;
};

const Ctx = createContext<ComposerCtx | null>(null);

export function useComposer(): ComposerCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useComposer must be used inside <AiComposerProvider>");
  return ctx;
}

type ProviderProps = {
  children: React.ReactNode;
};

export function AiComposerProvider({ children }: ProviderProps) {
  const sessionId = useChatStore((s) => s.activeSessionId);
  const captureOwner = useChatActionOwner(sessionId);
  const status = useChatStore((s) => s.agentMeta.status);
  const isBusy = status === "thinking" || status === "streaming";

  const [value, setValue] = useState("");
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [pickedSnippets, setPickedSnippets] = useState<Snippet[]>([]);
  const [pickedCommands, setPickedCommands] = useState<SlashCommandMeta[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submissionFocus = useRef<{
    publication: typeof captureOwner;
    frame: number;
  } | null>(null);
  const voiceFocus = useRef<{
    publication: typeof captureOwner;
    frame: number;
  } | null>(null);
  useEffect(
    () => () => {
      const voice = voiceFocus.current;
      if (voice?.publication === captureOwner) {
        cancelAnimationFrame(voice.frame);
        voiceFocus.current = null;
      }
      const pending = submissionFocus.current;
      if (pending?.publication !== captureOwner) return;
      cancelAnimationFrame(pending.frame);
      submissionFocus.current = null;
    },
    [captureOwner],
  );

  const focusSignal = useChatStore((s) => s.focusSignal);
  const pendingPrefill = useChatStore((s) => s.pendingPrefill);
  const consumePrefill = useChatStore((s) => s.consumePrefill);
  const pendingSelections = useChatStore((s) => s.pendingSelections);
  const consumeSelections = useChatStore((s) => s.consumeSelections);

  const attachFileByPath = useCallback(
    async (
      path: string,
      workspace: WorkspaceEnv,
      isCallerCurrent: () => boolean = () => true,
    ) => {
      const owner = captureOwner();
      const isCurrent = () => Boolean(owner?.isCurrent() && isCallerCurrent());
      if (!isCurrent() || !workspace) return false;
      const attachment = await readPathAttachment(path, workspace, isCurrent);
      if (!attachment || !isCurrent()) return false;
      setFiles((prev) =>
        !isCurrent() || prev.some((file) => file.id === attachment.id)
          ? prev : [...prev, attachment],
      );
      if (!isCurrent()) return false;
      useChatStore.getState().focusInput();
      return isCurrent();
    },
    [captureOwner],
  );

  const attachTextFile = useCallback(
    (
      attachment: { id: string; name: string; text: string; size: number },
      isCallerCurrent: () => boolean = () => true,
    ) => {
      const owner = captureOwner();
      const isCurrent = () => Boolean(owner?.isCurrent() && isCallerCurrent());
      if (!isCurrent()) return false;
      setFiles((prev) => {
        if (!isCurrent()) return prev;
        if (prev.some((file) => file.id === attachment.id)) return prev;
        return [
          ...prev,
          {
            ...attachment,
            kind: "text",
            mediaType: "text/plain",
          },
        ];
      });
      useChatStore.getState().focusInput();
      return isCurrent();
    },
    [captureOwner],
  );

  useEffect(() => {
    if (focusSignal === 0) return;
    textareaRef.current?.focus();
    if (pendingPrefill != null) {
      const text = consumePrefill();
      if (text) setValue((v) => (v ? `${text}${v}` : text));
    }
  }, [focusSignal, pendingPrefill, consumePrefill]);

  // Re-focus the textarea whenever the agent finishes a response
  const prevIsBusyRef = useRef(false);
  useEffect(() => {
    if (prevIsBusyRef.current && !isBusy) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    prevIsBusyRef.current = isBusy;
  }, [isBusy, textareaRef]);

  // Listen for explorer's "Attach to Agent" event.
  useEffect(() => {
    const onAttach = (e: Event) => {
      if (!captureOwner()) return;
      const request = takeFileAttachmentRequest((e as CustomEvent).detail);
      if (request) void attachFileByPath(request.path, request.workspace, request.isCurrent);
    };
    const onInsertPrompt = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt;
      if (typeof prompt === "string" && prompt.length > 0) {
        setValue((prev: string) => (prev ? `${prev}\n\n${prompt}` : prompt));
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    };
    window.addEventListener(FILE_ATTACHMENT_EVENT, onAttach);
    window.addEventListener("voktty:agent:insert-prompt", onInsertPrompt);
    return () => {
      window.removeEventListener(FILE_ATTACHMENT_EVENT, onAttach);
      window.removeEventListener("voktty:agent:insert-prompt", onInsertPrompt);
    };
  }, [attachFileByPath, captureOwner, setValue, textareaRef]);

  useEffect(() => {
    if (pendingSelections.length === 0) return;
    const drained = consumeSelections();
    if (drained.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.id));
      const next: FileAttachment[] = [];
      for (const sel of drained) {
        if (existing.has(sel.id)) continue;
        next.push({
          id: sel.id,
          name:
            sel.source === "editor"
              ? t("ai.editorSelection")
              : t("ai.terminalSelection"),
          kind: "selection",
          mediaType: "text/plain",
          text: sel.text,
          size: sel.text.length,
          source: sel.source,
        });
      }
      return next.length ? [...prev, ...next] : prev;
    });
  }, [pendingSelections, consumeSelections]);

  const captureVoice = useCallback(() => {
    const owner = captureOwner();
    return owner ? owner.isCurrent : null;
  }, [captureOwner]);
  const voice = useWhisperRecording({
    captureCurrent: captureVoice,
    onResult: (transcript: string) => {
      const owner = captureOwner();
      if (!owner) return;
      setValue((v) =>
        owner.isCurrent() ? (v ? `${v} ${transcript}` : transcript) : v,
      );
      if (voiceFocus.current) cancelAnimationFrame(voiceFocus.current.frame);
      const focus = {
        publication: captureOwner,
        frame: requestAnimationFrame(() => {
          if (voiceFocus.current === focus) voiceFocus.current = null;
          if (owner.isCurrent()) textareaRef.current?.focus();
        }),
      };
      voiceFocus.current = focus;
    },
  });

  const addFiles = useCallback(
    async (list: FileList | null) => {
      const owner = captureOwner();
      if (!list || !owner) return;
      await readBrowserAttachments(list, owner.isCurrent, (next) => {
        setFiles((prev) => {
          if (!owner.isCurrent()) return prev;
          const existing = new Set(prev.map((file) => file.id));
          const added = next.filter((file) => !existing.has(file.id));
          return added.length ? [...prev, ...added] : prev;
        });
      });
    },
    [captureOwner],
  );

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));

  const addSnippet = (s: Snippet) =>
    setPickedSnippets((prev) =>
      prev.some((p) => p.id === s.id) ? prev : [...prev, s],
    );
  const removeSnippet = (id: string) =>
    setPickedSnippets((prev) => prev.filter((s) => s.id !== id));

  const addCommand = (cmd: SlashCommandMeta) =>
    setPickedCommands((prev) =>
      prev.some((p) => p.name === cmd.name) ? prev : [...prev, cmd],
    );
  const removeCommand = (name: string) =>
    setPickedCommands((prev) => prev.filter((c) => c.name !== name));

  const submit = () => {
    const owner = captureOwner();
    if (!owner) return;
    if (isBusy) return;
    const trimmed = value.trim();
    if (
      !trimmed &&
      files.length === 0 &&
      pickedSnippets.length === 0 &&
      pickedCommands.length === 0
    )
      return;

    // Slash-command interception. `/plan` toggles plan mode; `/init` rewrites
    // the prompt to the VOKTTY.md scan template before sending.
    let effectiveText = trimmed;
    let commandMarker: string | null = null;
    let commandSource = trimmed;
    if (
      pickedCommands.length > 0 &&
      !trimmed.startsWith("/") &&
      !trimmed.startsWith("#")
    ) {
      commandSource = `#${pickedCommands[0].name} ${trimmed}`.trim();
    }
    if (commandSource.startsWith("/") || commandSource.startsWith("#")) {
      const outcome = tryRunSlashCommand(commandSource);
      if (outcome.kind === "handled") {
        setValue("");
        if (outcome.toast) console.info(outcome.toast);
        return;
      }
      if (outcome.kind === "send-prompt") {
        effectiveText = outcome.prompt;
        if (outcome.commandName) {
          commandMarker = `<voktty-command name="${outcome.commandName}" />`;
        }
      }
    }

    const parts: MessagePart[] = [];
    const fileBlocks = files
      .filter((f) => f.kind === "text")
      .map(
        (f) =>
          `<file name="${f.name}" mediaType="${f.mediaType}">\n${f.text ?? ""}\n</file>`,
      );
    const selectionBlocks = files
      .filter((f) => f.kind === "selection")
      .map(
        (f) =>
          `<selection source="${f.source ?? "terminal"}">\n${f.text ?? ""}\n</selection>`,
      );
    const { body: bodyAfterTokens, blocks: snippetBlocks } =
      expandSnippetTokens(effectiveText, useSnippetsStore.getState().snippets);
    const seenHandles = new Set<string>();
    const allSnippetBlocks: string[] = [];
    for (const s of pickedSnippets) {
      if (seenHandles.has(s.handle)) continue;
      seenHandles.add(s.handle);
      allSnippetBlocks.push(
        `<snippet name="${s.handle}">\n${s.content}\n</snippet>`,
      );
    }
    for (const block of snippetBlocks) {
      const m = block.match(/^<snippet name="([^"]+)"/);
      if (m && seenHandles.has(m[1])) continue;
      if (m) seenHandles.add(m[1]);
      allSnippetBlocks.push(block);
    }
    const selectedComponent = useLiveComponentStore.getState().selectedComponent;
    const componentBlock = selectedComponent
      ? formatComponentPromptDirective(selectedComponent)
      : "";

    const composed = [
      commandMarker ?? "",
      componentBlock,
      allSnippetBlocks.join("\n\n"),
      selectionBlocks.join("\n\n"),
      fileBlocks.join("\n\n"),
      bodyAfterTokens,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (composed) parts.push({ type: "text", text: composed });

    for (const f of files) {
      if (f.kind === "image" && f.url) {
        parts.push({
          type: "file",
          mediaType: f.mediaType,
          url: f.url,
          filename: f.name,
        });
      }
    }

    if (!sessionId) return;
    void owner.run(async (isActionCurrent) => {
      const { getOrCreateChat } = await import("../store/chatRuntime");
      if (!isActionCurrent()) return false;
      const chat = owner.resolve(() => getOrCreateChat(sessionId));
      if (!chat || chat.status === "submitted" || chat.status === "streaming")
        return false;
      const store = useChatStore.getState();
      store.presentChat();
      if (!isActionCurrent()) return false;
      store.patchAgentMeta({ hitStepCap: false, compactionNotice: null }, chat);
      if (!isActionCurrent()) return false;
      const submission = chat.sendMessage({ role: "user", parts } as Parameters<
        typeof chat.sendMessage
      >[0]);
      setValue((current) =>
        isActionCurrent() && current === value ? "" : current,
      );
      setFiles((current) =>
        isActionCurrent() && current === files ? [] : current,
      );
      setPickedSnippets((current) =>
        isActionCurrent() && current === pickedSnippets ? [] : current,
      );
      setPickedCommands((current) =>
        isActionCurrent() && current === pickedCommands ? [] : current,
      );
      if (submissionFocus.current)
        cancelAnimationFrame(submissionFocus.current.frame);
      const focus = {
        publication: captureOwner,
        frame: requestAnimationFrame(() => {
          if (submissionFocus.current === focus) submissionFocus.current = null;
          if (isActionCurrent()) textareaRef.current?.focus();
        }),
      };
      submissionFocus.current = focus;
      await submission;
      return true;
    });
  };

  const stop = () => {
    const owner = captureOwner();
    owner?.cancelPending();
    if (owner && submissionFocus.current?.publication === captureOwner) {
      cancelAnimationFrame(submissionFocus.current.frame);
      submissionFocus.current = null;
    }
    void owner?.resolve()?.stop();
  };

  const canSend =
    !isBusy &&
    (value.trim().length > 0 ||
      files.length > 0 ||
      pickedSnippets.length > 0 ||
      pickedCommands.length > 0 ||
      useLiveComponentStore.getState().selectedComponent !== null);

  const ctx: ComposerCtx = {
    textareaRef,
    value,
    setValue,
    files,
    addFiles,
    attachFileByPath,
    attachTextFile,
    removeFile,
    pickedSnippets,
    addSnippet,
    removeSnippet,
    pickedCommands,
    addCommand,
    removeCommand,
    isBusy,
    submit,
    stop,
    voice,
    canSend,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
