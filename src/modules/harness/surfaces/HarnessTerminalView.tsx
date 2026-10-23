import { useContext, useLayoutEffect, useRef, useState } from "react";
import { TerminalSurface } from "@/modules/terminal/TerminalSurface";
import type { FilePaneTab } from "@/modules/harness/lib/layout";
import type { TerminalMetaPatch } from "@/modules/harness/lib/terminalTab";
import { TerminalView } from "@/modules/harness/surfaces/TerminalView";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import { HarnessTerminalRecovery } from "@/modules/harness/hooks/useHarnessTerminalRecovery";
import { useCanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import { useTranslation } from "@/modules/i18n";

export function HarnessTerminalView({
  file,
  visible,
  active,
  layoutKey,
  slotKey,
  onFocus,
  onMetaChange,
}: {
  file: FilePaneTab;
  visible: boolean;
  active: boolean;
  layoutKey?: string | number;
  slotKey?: string;
  onFocus?: () => void;
  onMetaChange?: (patch: TerminalMetaPatch) => void;
}) {
  const owner = useContext(HarnessTerminalOwner);
  const recover = useContext(HarnessTerminalRecovery);
  const catalog = useCanonicalTerminalCatalog();
  const { t } = useTranslation();
  const lifetime = useRef<object | null>(null);
  const pending = useRef<object | null>(null);
  const [recovering, setRecovering] = useState(false);
  useLayoutEffect(() => {
    const current = {
      file,
      slotKey,
      visible,
      ownerTabKey: owner?.tabKey,
      ownerVisible: owner?.visible,
    };
    lifetime.current = current;
    return () => {
      if (lifetime.current === current) lifetime.current = null;
    };
  }, [file, slotKey, visible, owner?.tabKey, owner?.visible]);
  const reference = file.canonicalTerminal;
  if (reference) {
    if (!owner) return null;
    return (
      <TerminalSurface
        tabKey={reference.tabKey}
        ownerTabKey={owner.tabKey}
        projectCwd={reference.projectCwd}
        visible={owner.visible && visible}
        focused={active}
        onFocus={() => {
          owner.onFocus?.();
          onFocus?.();
        }}
        layoutKey={`${owner.layoutKey ?? ""}:${layoutKey ?? ""}`}
        slotKey={slotKey}
      >
        {catalog && !catalog.get(reference) ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground"
            role="status"
            aria-busy={recovering}
          >
            <p>{t("terminal.connection.disconnected", { name: file.path })}</p>
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-foreground hover:bg-accent disabled:opacity-50"
              disabled={
                recovering || !recover || !slotKey || !visible || !owner.visible
              }
              onClick={() => {
                const original = lifetime.current;
                if (!original || pending.current || !recover || !slotKey)
                  return;
                const operation = {};
                pending.current = operation;
                setRecovering(true);
                const finish = () => {
                  if (pending.current !== operation) return;
                  pending.current = null;
                  if (lifetime.current) setRecovering(false);
                };
                if (
                  !recover(
                    file,
                    slotKey,
                    () => lifetime.current === original,
                    finish,
                  )
                )
                  finish();
              }}
            >
              {t("harness.chrome.newTerminalTab")}
            </button>
          </div>
        ) : null}
      </TerminalSurface>
    );
  }
  return (
    <TerminalView
      id={file.id}
      cwd={file.cwd}
      active={active}
      onMetaChange={onMetaChange}
    />
  );
}
