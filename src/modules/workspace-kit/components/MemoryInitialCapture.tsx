import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import { initialMemoryPrompt } from "@/modules/workspace-kit/lib/initialMemoryPrompt";

let pendingCopies = 0;

export function MemoryInitialCapture({
  root,
  prepare,
}: {
  root: string;
  prepare?: (prompt: string) => boolean;
}) {
  const { t } = useTranslation();
  const prompt = useMemo(() => initialMemoryPrompt(root), [root]);
  const lifetime = useMemo(() => ({ prompt, active: false }), [prompt]);
  const pending = useRef(false);
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );
  useLayoutEffect(() => {
    lifetime.active = true;
    setStatus("idle");
    return () => {
      lifetime.active = false;
    };
  }, [lifetime]);
  function open() {
    if (!lifetime.active || !prepare) return;
    try {
      if (!prepare(prompt) && lifetime.active) setStatus("error");
    } catch {
      if (lifetime.active) setStatus("error");
    }
  }
  async function copy() {
    if (!lifetime.active || pending.current || pendingCopies >= 256) return;
    pending.current = true;
    pendingCopies++;
    setStatus("copying");
    try {
      const { copyText } = await import("@/modules/harness/lib/clipboard");
      if (!lifetime.active) return;
      await copyText(lifetime.prompt, () => {
        if (!lifetime.active) throw new Error("Initial memory request retired");
      });
      if (lifetime.active) setStatus("copied");
    } catch {
      if (lifetime.active) setStatus("error");
    } finally {
      pending.current = false;
      pendingCopies--;
    }
  }
  return (
    <section className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <h3 className="font-medium">{t("projectMemory.conversationPrepare")}</h3>
      <details>
        <summary>{t("projectMemory.conversationPreview")}</summary>
        <pre
          className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs"
          dir="auto"
        >
          {prompt}
        </pre>
      </details>
      <div className="flex gap-2">
        {prepare ? (
          <Button size="sm" onClick={open}>
            {t("common.open")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={status === "copying"}
          onClick={() => void copy()}
        >
          {t("common.copy")}
        </Button>
      </div>
      {status === "copied" ? <p role="status">{t("common.copied")}</p> : null}
      {status === "error" ? <p role="alert">{t("common.error")}</p> : null}
    </section>
  );
}
