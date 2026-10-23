import { useContext } from "react";
import { TerminalSurface } from "@/modules/terminal/TerminalSurface";
import type { FilePaneTab } from "@/modules/harness/lib/layout";
import type { TerminalMetaPatch } from "@/modules/harness/lib/terminalTab";
import { TerminalView } from "@/modules/harness/surfaces/TerminalView";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";

export function HarnessTerminalView({
  file,
  visible,
  active,
  layoutKey,
  onFocus,
  onMetaChange,
}: {
  file: FilePaneTab;
  visible: boolean;
  active: boolean;
  layoutKey?: string | number;
  onFocus?: () => void;
  onMetaChange?: (patch: TerminalMetaPatch) => void;
}) {
  const owner = useContext(HarnessTerminalOwner);
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
      />
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
