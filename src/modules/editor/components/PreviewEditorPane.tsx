import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentPropsWithRef,
} from "react";
import { EditorPane } from "@/modules/editor/EditorPane";
import type { EditorTab } from "@/modules/tabs/lib/useTabs";
import type {
  PreviewDocumentAction,
  PreviewOpeningAction,
} from "@/modules/preview/lib/previewOpeningTarget";

type Props = Omit<ComponentPropsWithRef<typeof EditorPane>, "onOpenPreview"> & {
  tab: EditorTab;
  visible: boolean;
  onOpenPreview?: PreviewOpeningAction;
};

export function PreviewEditorPane({
  tab,
  visible,
  onOpenPreview,
  ...props
}: Props) {
  const { id, tabKey, path, spaceId, workspaceEnv } = tab;
  const binding = useMemo(
    () => ({ id, tabKey, path, spaceId, workspaceEnv, visible, onOpenPreview }),
    [id, tabKey, path, spaceId, workspaceEnv, visible, onOpenPreview],
  );
  const owner = useRef<object | null>(null);
  const latest = useRef(tab);
  useLayoutEffect(() => {
    latest.current = tab;
  });
  useLayoutEffect(() => {
    owner.current = binding;
    return () => {
      if (owner.current === binding) owner.current = null;
    };
  }, [binding]);
  const open = useCallback<PreviewDocumentAction>(
    (requestedPath, callerCurrent) => {
      const current = () =>
        owner.current === binding &&
        binding.visible &&
        callerCurrent?.() !== false;
      if (!current() || requestedPath !== binding.path) return;
      return binding.onOpenPreview?.(requestedPath, {
        source: latest.current,
        current,
      });
    },
    [binding],
  );
  return (
    <EditorPane {...props} onOpenPreview={onOpenPreview ? open : undefined} />
  );
}
