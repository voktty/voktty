import { ChevronDown, Lock, LockOpen, Pencil, Sparkles } from "./icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../lib/session";

type Props = {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 288;

const ICONS: Record<RuntimeMode, typeof Lock> = {
  supervised: Lock,
  "auto-accept-edits": Pencil,
  auto: Sparkles,
  "full-access": LockOpen,
};

function menuStyle(anchor: DOMRect): CSSProperties {
  const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
  const left = Math.min(
    Math.max(8, anchor.left),
    window.innerWidth - width - 8,
  );
  return {
    position: "fixed",
    left,
    bottom: window.innerHeight - anchor.top + 6,
    width,
    zIndex: 50,
  };
}

export function AccessPicker({ value, onChange, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(0, RUNTIME_MODES.indexOf(value)),
  );
  const [menu, setMenu] = useState<CSSProperties>();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const Icon = ICONS[value];

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, RUNTIME_MODES.indexOf(value)));
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (rect) setMenu(menuStyle(rect));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open, menu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) dismiss(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      dismiss(true);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pick = (mode: RuntimeMode) => {
    onChange(mode);
    dismiss(true);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(RUNTIME_MODES.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const mode = RUNTIME_MODES[active];
      if (mode) pick(mode);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title={RUNTIME_MODE_HINT[value]}
        aria-label={RUNTIME_MODE_LABEL[value]}
        aria-expanded={open}
        aria-haspopup="listbox"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          const rect = root.current?.getBoundingClientRect();
          if (rect) setMenu(menuStyle(rect));
          setOpen(true);
        }}
        className={`flex h-6.5 max-w-52 items-center gap-1 rounded-md px-1.5 ${
          open
            ? "bg-content/10 text-content"
            : "bg-content/10 text-content hover:bg-content/15"
        }`}
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate text-[11px]">
          {RUNTIME_MODE_LABEL[value]}
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && menu ? (
        <div
          ref={list}
          role="listbox"
          aria-label="Access"
          data-access-picker
          tabIndex={-1}
          style={menu}
          onKeyDown={onMenuKey}
          className="rounded-xl border border-content/10 bg-content/10 p-1 shadow-xl backdrop-blur-xl outline-none"
        >
          {RUNTIME_MODES.map((mode, index) => {
            const ModeIcon = ICONS[mode];
            const selected = mode === value;
            const highlighted = index === active;
            return (
              <button
                key={mode}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(mode)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left ${
                  highlighted || selected
                    ? "bg-content/10 text-content"
                    : "text-content hover:bg-content/5"
                }`}
              >
                <ModeIcon
                  className="mt-0.5 size-3.5 shrink-0 text-content/70"
                  strokeWidth={1.75}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-5">
                    {RUNTIME_MODE_LABEL[mode]}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-content/50">
                    {RUNTIME_MODE_HINT[mode]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
