import { MessageSquarePlus } from "../chrome/icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  placeSelectionMenu,
  type TranscriptSelection,
} from "../lib/transcriptSelection";

type Props = {
  selection: TranscriptSelection | null;
  onAddToChat: (text: string) => void;
  onDismiss: () => void;
};

export function TranscriptSelectionMenu({
  selection,
  onAddToChat,
  onDismiss,
}: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const [pos, setPos] = useState<CSSProperties>({
    left: 0,
    top: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const el = menu.current;
    if (!selection || !el) return;
    const rect = el.getBoundingClientRect();
    const next = placeSelectionMenu(
      selection.rect,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ left: next.left, top: next.top, visibility: "visible" });
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const dismiss = () => onDismissRef.current();
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      dismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection]);

  if (!selection) return null;

  return createPortal(
    <div
      ref={menu}
      role="toolbar"
      aria-label="Selected text actions"
      style={{ position: "fixed", ...pos, zIndex: 80 }}
      className="rounded-lg border border-content/10 bg-content/10 p-1 shadow-xl outline-none backdrop-blur-xl"
    >
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onAddToChat(selection.text);
          window.getSelection()?.removeAllRanges();
          onDismiss();
        }}
        className="flex h-7 items-center gap-1.5 rounded-lg px-2 font-sans text-[13px] leading-none text-content outline-none ring-accent/40 hover:bg-content/5 focus-visible:ring-2"
      >
        <MessageSquarePlus
          aria-hidden="true"
          className="size-3.5"
          strokeWidth={1.75}
        />
        Add to chat
      </button>
    </div>,
    document.body,
  );
}
