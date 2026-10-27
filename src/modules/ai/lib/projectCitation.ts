import {
  createProjectFileSourceStore,
  isProjectFileSource,
  type ProjectFileSource,
} from "@/modules/remote/projectFileSource";
import { captureProjectAttachment } from "@/modules/ai/lib/projectAttachmentSource";
import { isCitationRelativePath } from "@/modules/ai/lib/workspaceCitationFiles";

let pending = 0;

export function captureProjectCitation(
  root: string,
  relative: string,
  indexed: ProjectFileSource,
) {
  if (
    pending >= 16 ||
    !isProjectFileSource(indexed, root) ||
    !isCitationRelativePath(relative)
  )
    return null;
  const store = createProjectFileSourceStore(root);
  const release = store.subscribe(() => {});
  const source = store.getSnapshot().source;
  const path = `${root.replace(/\/+$/, "")}/${relative}`;
  const owner = captureProjectAttachment(root);
  const attachment = owner ? captureProjectAttachment(path, owner) : null;
  if (
    !source ||
    source.key !== indexed.key ||
    !attachment ||
    !indexed.isCurrent()
  ) {
    release();
    return null;
  }
  pending++;
  let current = true;
  return {
    path,
    workspace: { kind: "local" as const },
    projectSource: attachment,
    isCurrent: () => current && source.isCurrent(),
    release: () => {
      if (!current) return;
      current = false;
      pending--;
      release();
    },
  };
}
