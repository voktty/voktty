import { Popover, PopoverAnchor } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";
import { readGuestFile } from "@/modules/collab/lib/guestRuntime";
import { useTranslation } from "@/modules/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceFiles } from "../hooks/useWorkspaceFiles";
import { useComposer } from "../lib/composer";
import { SLASH_COMMANDS } from "../lib/slashCommands";
import { useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";
import { FilePickerContent } from "./FilePicker";
import { type PickerItem, SnippetPickerContent } from "./SnippetPicker";

type SnippetTrigger = {
  start: number;
  end: number;
  query: string;
  char: "#" | "/";
};

type FileTrigger = {
  start: number;
  end: number;
  query: string;
};

function detectSnippetTrigger(
  value: string,
  caret: number,
): SnippetTrigger | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === "#" || ch === "/") {
      const prev = i === 0 ? " " : value[i - 1];
      if (!/\s/.test(prev)) return null;
      const slice = value.slice(i + 1, caret);
      if (!/^[a-z0-9-]*$/i.test(slice)) return null;
      return { start: i, end: caret, query: slice.toLowerCase(), char: ch };
    }
    if (/\s/.test(ch)) return null;
    if (!/[a-z0-9-]/i.test(ch)) return null;
  }
  return null;
}

function detectFileTrigger(value: string, caret: number): FileTrigger | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === "@") {
      const prev = i === 0 ? " " : value[i - 1];
      if (!/\s/.test(prev)) return null;
      const slice = value.slice(i + 1, caret);
      return { start: i, end: caret, query: slice };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

export function AiComposerInput() {
  const { t } = useTranslation();
  const c = useComposer();
  const snippets = useSnippetsStore((s) => s.snippets);
  const live = useChatStore((state) => state.live);
  const focusSignal = useChatStore((state) => state.focusSignal);
  const fileSource = live.getFileCitationSource();
  const workspaceRoot = fileSource.kind === "local" ? fileSource.root : null;

  const [trigger, setTrigger] = useState<SnippetTrigger | null>(null);
  const [fileTrigger, setFileTrigger] = useState<FileTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileQuery, setFileQuery] = useState("");
  const workspaceFiles = useWorkspaceFiles(
    fileSource,
    fileQuery,
    fileTrigger !== null,
  );
  useEffect(() => {
    if (!fileTrigger) {
      setFileQuery("");
      return;
    }
    const q = fileTrigger.query;
    const t = window.setTimeout(() => setFileQuery(q), 50);
    return () => window.clearTimeout(t);
  }, [fileTrigger]);

  useEffect(() => {
    autoresize(c.textareaRef.current);
  }, [c.value, c.textareaRef]);

  // focusInput() can fire while the sidebar is still loading this lazy
  // component. Retry once after mount so the signal is not lost before the
  // textarea exists.
  useEffect(() => {
    if (focusSignal === 0) return;
    const frame = requestAnimationFrame(() => {
      const el = c.textareaRef.current;
      if (!el) return;
      el.focus();
      autoresize(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusSignal, c.textareaRef]);

  const updateTrigger = () => {
    const el = c.textareaRef.current;
    if (!el) {
      setTrigger(null);
      setFileTrigger(null);
      return;
    }
    const caret = el.selectionStart ?? 0;
    setTrigger(detectSnippetTrigger(c.value, caret));
    setFileTrigger(detectFileTrigger(c.value, caret));
  };

  useEffect(updateTrigger, [c.value, c.textareaRef]);

  const filteredItems = useMemo<PickerItem[]>(() => {
    if (!trigger) return [];
    const q = trigger.query;
    const cmdItems: PickerItem[] = Object.values(SLASH_COMMANDS)
      .map((command) => ({
        kind: "command" as const,
        command,
        label: t(command.labelKey),
      }))
      .filter(
        (item) =>
          !q ||
          item.command.name.includes(q) ||
          item.label.toLowerCase().includes(q),
      );
    if (trigger.char === "/") return cmdItems;
    const snipItems: PickerItem[] = snippets
      .filter(
        (s) =>
          !q ||
          s.handle.includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      )
      .map((snippet) => ({ kind: "snippet", snippet }));
    return [...cmdItems, ...snipItems];
  }, [trigger, snippets, t]);

  const FILE_PICKER_CAP = 30;
  const filteredFiles = useMemo<string[]>(() => {
    if (!fileTrigger) return [];
    const q = fileQuery.toLowerCase();
    if (!q) return workspaceFiles.files.slice(0, FILE_PICKER_CAP);
    const out: string[] = [];
    for (const f of workspaceFiles.files) {
      if (f.toLowerCase().includes(q)) {
        out.push(f);
        if (out.length >= FILE_PICKER_CAP) break;
      }
    }
    return out;
  }, [fileTrigger, fileQuery, workspaceFiles.files]);

  const fileTriggerOpen = fileTrigger !== null;
  const snippetTriggerOpen = trigger !== null;
  useEffect(() => {
    setActiveIndex(0);
  }, [snippetTriggerOpen, fileTriggerOpen, fileQuery]);

  const pickerOpen = trigger !== null || fileTrigger !== null;

  const onPickItem = (item: PickerItem) => {
    if (!trigger) return;
    const before = c.value.slice(0, trigger.start);
    const afterRaw = c.value.slice(trigger.end);
    let insert = "";
    if (item.kind === "snippet") {
      const needsSpace = afterRaw.length === 0 || !/^\s/.test(afterRaw);
      insert = `#${item.snippet.handle}${needsSpace ? " " : ""}`;
      c.addSnippet(item.snippet);
    } else {
      c.addCommand(item.command);
    }
    const after =
      item.kind === "command" ? afterRaw.replace(/^\s+/, "") : afterRaw;
    c.setValue(`${before}${insert}${after}`);
    setTrigger(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const el = c.textareaRef.current;
      if (!el) return;
      const caret = before.length + insert.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const onPickFile = async (filePath: string) => {
    if (!fileTrigger) return;
    const before = c.value.slice(0, fileTrigger.start);
    const after = c.value.slice(fileTrigger.end);
    c.setValue(`${before}${after}`);
    setFileTrigger(null);
    setActiveIndex(0);
    try {
      if (fileSource.kind === "collab") {
        const remote = await readGuestFile(fileSource.leafId, filePath);
        const name = remote.path.split("/").pop() || remote.path;
        c.attachTextFile({
          id: `collab-${fileSource.leafId}-${remote.path}`,
          name,
          text: remote.content,
          size: remote.content.length,
        });
      } else if (workspaceRoot) {
        const sep =
          workspaceRoot.includes("\\") && !workspaceRoot.includes("/")
            ? "\\"
            : "/";
        const fullPath = workspaceRoot.endsWith(sep)
          ? `${workspaceRoot}${filePath}`
          : `${workspaceRoot}${sep}${filePath}`;
        await c.attachFileByPath(fullPath);
      }
    } catch (error) {
      console.error("remote file citation failed", error);
    }
    requestAnimationFrame(() => {
      const el = c.textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const pickActive = () => {
    if (fileTrigger) {
      const file = filteredFiles[activeIndex];
      if (file) void onPickFile(file);
      return;
    }
    const it = filteredItems[activeIndex];
    if (it) onPickItem(it);
  };

  const voiceLabel = c.voice.recording
    ? t("ai.listening")
    : c.voice.transcribing
      ? t("ai.transcribing")
      : null;
  const voiceRow = usePresence(Boolean(voiceLabel), 180);
  const lastVoiceLabel = useRef("");
  if (voiceLabel) lastVoiceLabel.current = voiceLabel;

  return (
    <>
      <Popover open={pickerOpen}>
        <PopoverAnchor asChild>
          <div className="flex items-start gap-2">
            <textarea
              ref={c.textareaRef}
              value={c.value}
              onChange={(e) => c.setValue(e.target.value)}
              onKeyUp={updateTrigger}
              onClick={updateTrigger}
              onSelect={updateTrigger}
              onKeyDown={(e) => {
                if (pickerOpen) {
                  const items = fileTrigger ? filteredFiles : filteredItems;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((i) =>
                      Math.min(i + 1, Math.max(0, items.length - 1)),
                    );
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((i) => Math.max(0, i - 1));
                    return;
                  }
                  if (e.key === "Tab" || e.key === "Enter") {
                    if (items.length > 0) {
                      e.preventDefault();
                      pickActive();
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (fileTrigger) {
                      const before = c.value.slice(0, fileTrigger.start);
                      const after = c.value.slice(fileTrigger.end);
                      c.setValue(`${before}${after}`);
                      setFileTrigger(null);
                    } else {
                      setTrigger(null);
                    }
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  c.submit();
                }
              }}
              placeholder={t("ai.inputPlaceholder")}
              rows={1}
              className={cn(
                "max-h-40 w-full min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none",
                "placeholder:text-muted-foreground/60",
              )}
            />
          </div>
        </PopoverAnchor>
        {fileTrigger ? (
          <FilePickerContent
            files={filteredFiles}
            activeIndex={activeIndex}
            indexing={workspaceFiles.indexing}
            truncated={workspaceFiles.truncated}
            hasWorkspace={workspaceFiles.hasWorkspace}
            remote={workspaceFiles.remote}
            error={workspaceFiles.error}
            onPick={(f) => void onPickFile(f)}
            onHover={setActiveIndex}
          />
        ) : (
          <SnippetPickerContent
            items={filteredItems}
            activeIndex={activeIndex}
            onPick={onPickItem}
            onHover={setActiveIndex}
          />
        )}
      </Popover>

      {voiceRow.mounted && (
        <div data-state={voiceRow.state} className="voktty-reveal">
          <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            {c.voice.recording ? (
              <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
            ) : (
              <Spinner className="size-3" />
            )}
            <span className="truncate">
              {voiceLabel || lastVoiceLabel.current}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function autoresize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}
