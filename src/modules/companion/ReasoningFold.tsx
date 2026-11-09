import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Spinner } from "panelui-web/spinner";

type Props = {
  text: string;
  streaming: boolean;
  label: string;
  liveLabel: string;
};

/** Model reasoning stays folded on the phone; the user opens it on demand. */
export function ReasoningFold({ text, streaming, label, liveLabel }: Props) {
  const [open, setOpen] = useState(false);
  const canOpen = text.length > 0;

  return (
    <div className="mr-auto max-w-[92%] rounded-xl border border-border/40 bg-muted/20 text-xs">
      <button
        type="button"
        aria-expanded={open}
        disabled={!canOpen}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground disabled:cursor-default"
      >
        {streaming ? (
          <Spinner variant="dots" size="sm" label={liveLabel} />
        ) : (
          <HugeiconsIcon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={13} />
        )}
        <span className="font-medium">{streaming ? liveLabel : label}</span>
      </button>
      {open && canOpen ? (
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-t border-border/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {text}
        </p>
      ) : null}
    </div>
  );
}
