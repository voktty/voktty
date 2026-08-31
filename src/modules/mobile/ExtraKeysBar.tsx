import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  getActiveTerminalLeafId,
  leafGridSelection,
  writeToSession,
} from "@/modules/terminal/lib/useTerminalSession";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "@/modules/terminal/lib/terminalClipboard";

export const EXTRA_KEYS_HEIGHT = 38;

type Modifier = "ctrl" | "alt";

interface ExtraKeysBarProps {
  visible?: boolean;
  isTablet?: boolean;
  activeLeafId?: number | null;
  selectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  onOpenSettings?: () => void;
}

export function ExtraKeysBar({
  visible = true,
  isTablet = false,
  activeLeafId = null,
  selectionMode = false,
  onToggleSelectionMode,
  onOpenSettings,
}: ExtraKeysBarProps) {
  const { t } = useTranslation();
  const [modifiers, setModifiers] = useState<Set<Modifier>>(new Set());
  const modifiersRef = useRef(modifiers);
  modifiersRef.current = modifiers;

  const activeLeaf = activeLeafId ?? getActiveTerminalLeafId();
  const leafRef = useRef(activeLeaf);
  leafRef.current = activeLeaf;

  const clearModifiers = useCallback(() => {
    setModifiers(new Set());
  }, []);

  const toggleModifier = useCallback((mod: Modifier) => {
    setModifiers((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  }, []);

  const handleDirectKey = useCallback(
    (sequence: string) => {
      const leaf = leafRef.current;
      if (leaf === null) return;
      writeToSession(leaf, sequence);
      clearModifiers();
    },
    [clearModifiers],
  );

  const handleCopy = useCallback(async () => {
    const leaf = leafRef.current;
    if (leaf === null) return;
    const text = leafGridSelection(leaf);
    if (text) {
      await writeTerminalClipboard(text);
    }
  }, []);

  const handlePaste = useCallback(async () => {
    const leaf = leafRef.current;
    if (leaf === null) return;
    const text = await readTerminalClipboard();
    if (text) {
      writeToSession(leaf, text);
    }
  }, []);

  useEffect(() => {
    if (modifiers.size === 0) return;

    const onBeforeInput = (e: InputEvent) => {
      const mods = modifiersRef.current;
      if (mods.size === 0) return;
      if (!e.data || e.data.length === 0) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const char = e.data[0];
      let data = "";
      if (mods.has("alt")) data += "\x1b";
      if (mods.has("ctrl")) {
        data += String.fromCharCode(char.toUpperCase().charCodeAt(0) & 0x1f);
      } else {
        data += char;
      }

      const leaf = leafRef.current;
      if (leaf !== null) writeToSession(leaf, data);
      clearModifiers();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const mods = modifiersRef.current;
      if (mods.size === 0) return;

      const key = e.key;
      if (
        key === "Control" ||
        key === "Alt" ||
        key === "Shift" ||
        key === "Meta"
      ) {
        return;
      }

      if (key.length > 1 && key !== "Enter" && key !== "Backspace") {
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      let data = "";
      if (mods.has("alt")) data += "\x1b";
      if (mods.has("ctrl")) {
        data += String.fromCharCode(key.toUpperCase().charCodeAt(0) & 0x1f);
      } else {
        data += key;
      }

      const leaf = leafRef.current;
      if (leaf !== null) writeToSession(leaf, data);
      clearModifiers();
    };

    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("beforeinput", onBeforeInput, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [modifiers.size, clearModifiers]);

  useEffect(() => {
    if (!visible) clearModifiers();
  }, [visible, clearModifiers]);

  useEffect(() => {
    if (modifiers.size === 0) return;
    const timer = setTimeout(() => clearModifiers(), 5000);
    return () => clearTimeout(timer);
  }, [modifiers, clearModifiers]);

  if (!visible) return null;

  const ctrlActive = modifiers.has("ctrl");
  const altActive = modifiers.has("alt");

  return (
    <>
      {selectionMode && (
        <div
          className="pointer-events-auto absolute right-2 z-50 flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/95 px-2.5 py-1.5 shadow-xl backdrop-blur"
          style={{ top: 8 }}
        >
          <span className="mr-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            SEL
          </span>
          <ActionBtn label={t("common.copy")} onClick={handleCopy} />
          <ActionBtn label={t("common.paste")} onClick={handlePaste} />
          <ActionBtn
            label={t("common.apply")}
            onClick={onToggleSelectionMode ?? (() => {})}
            primary
          />
        </div>
      )}
      <div
        className="flex items-center gap-1 overflow-x-auto border-t border-border/60 bg-background/95 px-1.5 backdrop-blur no-scrollbar"
        style={{
          height: isTablet ? 42 : EXTRA_KEYS_HEIGHT,
          touchAction: "pan-x",
        }}
      >
        <KeyButton
          label="CTRL"
          active={ctrlActive}
          onClick={() => toggleModifier("ctrl")}
          tall={isTablet}
        />
        <KeyButton
          label="ALT"
          active={altActive}
          onClick={() => toggleModifier("alt")}
          tall={isTablet}
        />
        {onToggleSelectionMode && (
          <KeyButton
            label="SEL"
            active={selectionMode}
            onClick={onToggleSelectionMode}
            tall={isTablet}
          />
        )}
        <Divider />
        <KeyButton
          label="ESC"
          onClick={() => handleDirectKey("\x1b")}
          tall={isTablet}
        />
        <KeyButton
          label="TAB"
          onClick={() => handleDirectKey("\t")}
          tall={isTablet}
        />
        <KeyButton
          label="HOME"
          onClick={() => handleDirectKey("\x1b[H")}
          tall={isTablet}
        />
        <KeyButton
          label="END"
          onClick={() => handleDirectKey("\x1b[F")}
          tall={isTablet}
        />
        <Divider />
        <KeyButton
          label="←"
          onClick={() => handleDirectKey("\x1b[D")}
          tall={isTablet}
        />
        <KeyButton
          label="↑"
          onClick={() => handleDirectKey("\x1b[A")}
          tall={isTablet}
        />
        <KeyButton
          label="↓"
          onClick={() => handleDirectKey("\x1b[B")}
          tall={isTablet}
        />
        <KeyButton
          label="→"
          onClick={() => handleDirectKey("\x1b[C")}
          tall={isTablet}
        />
        <Divider />
        {(["-", "/", "|", "~", "$", "&", ";", "."] as const).map((sym) => (
          <KeyButton
            key={sym}
            label={sym}
            onClick={() => handleDirectKey(sym)}
            tall={isTablet}
          />
        ))}
        {onOpenSettings && (
          <>
            <Divider />
            <KeyButton
              label="⚙"
              onClick={onOpenSettings}
              tall={isTablet}
            />
          </>
        )}
      </div>
    </>
  );
}

function KeyButton({
  label,
  active = false,
  onClick,
  tall = false,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  tall?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-[34px] shrink-0 items-center justify-center rounded px-2 text-xs font-semibold select-none transition-colors",
        tall ? "h-8" : "h-7",
        "bg-secondary/70 text-secondary-foreground hover:bg-secondary active:bg-secondary/90",
        active &&
          "bg-primary text-primary-foreground shadow-sm shadow-primary/30 active:bg-primary/90",
      )}
    >
      {label}
    </button>
  );
}

function ActionBtn({
  label,
  onClick,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium transition-colors",
        primary
          ? "bg-primary text-primary-foreground active:bg-primary/90"
          : "bg-secondary text-secondary-foreground active:bg-secondary/80",
      )}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border/60" />;
}
