import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  createMemoryIndicator,
  type MemoryIndicatorState,
} from "@/modules/workspace-kit/lib/memoryIndicator";
import {
  supportedMemoryPanelTarget,
  type MemoryPanelTarget,
} from "@/modules/workspace-kit/lib/memoryPanel";

const messages = {
  checking: "projectMemory.checking",
  found: "projectMemory.found",
  absent: "projectMemory.absent",
  review: "projectMemory.review",
  error: "projectMemory.error",
  unsupported: "projectMemory.unsupported",
  noTarget: "projectMemory.noTarget",
} as const;

export default function MemoryIndicator({
  target,
  active,
  descriptionId,
}: {
  target: MemoryPanelTarget | null;
  active: boolean;
  descriptionId: string;
}) {
  const { t } = useTranslation();
  const key = JSON.stringify(target);
  const [observed, setObserved] = useState<{
    key: string;
    state: MemoryIndicatorState;
  }>({ key, state: "checking" });
  useEffect(() => {
    if (!active || !target || !supportedMemoryPanelTarget(target)) return;
    let live = true;
    let controller: ReturnType<typeof createMemoryIndicator>;
    try {
      controller = createMemoryIndicator(target, (state) => {
        if (live) setObserved({ key, state });
      });
    } catch {
      setObserved({ key, state: "error" });
      return;
    }
    const timer = setTimeout(() => {
      void controller.load();
    }, 200);
    const refresh = () => {
      clearTimeout(timer);
      void controller.load();
    };
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      void controller.dispose();
    };
  }, [target, active, key]);
  const current = !target
    ? "noTarget"
    : !supportedMemoryPanelTarget(target)
      ? "unsupported"
      : observed.key === key
        ? observed.state
        : "checking";
  const message = t(messages[current]);
  return (
    <span
      data-memory-state={current}
      title={message}
      className={cn(
        "inline-flex",
        current === "found" && "text-emerald-500",
        (current === "review" || current === "error") && "text-amber-500",
        current === "checking" && "animate-pulse",
      )}
    >
      <HugeiconsIcon
        icon={BrainIcon}
        size={14}
        strokeWidth={1.75}
        aria-hidden
      />
      <span id={descriptionId} className="sr-only">
        {message}
      </span>
    </span>
  );
}
