import { useCallback } from "react";
import { joinPath } from "@/modules/explorer/lib/useFileTree";
import { SourceControlPanel } from "@/modules/source-control/SourceControlPanel";
import { useSourceControl } from "@/modules/source-control/useSourceControl";
import type { HarnessId } from "../lib/session";
import type { FileOpenOptions } from "../lib/search";

type Props = {
  cwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
  selectedPath?: string;
  onOpenFile: (path: string) => void;
  onOpenDiff?: (path: string, options?: FileOpenOptions) => void;
};

export function SourceControl({
  cwd,
  enabled,
  onOpenFile,
  onOpenDiff,
}: Props) {
  const sourceControl = useSourceControl(cwd, enabled);

  const handleOpenDiff = useCallback(
    (input: {
      path: string;
      repoRoot: string;
      mode: "+" | "-";
      originalPath: string | null;
      title?: string;
    }) => {
      const path = joinPath(input.repoRoot, input.path);
      if (onOpenDiff) {
        onOpenDiff(path, { exact: true });
      } else {
        onOpenFile(path);
      }
    },
    [onOpenFile, onOpenDiff],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <SourceControlPanel
        open={enabled}
        sourceControl={sourceControl}
        onOpenDiff={handleOpenDiff}
        onOpenFile={onOpenFile}
        repositoryTarget={{ mode: "follow-context" }}
        onFollowRepositoryContext={() => {}}
      />
    </div>
  );
}
