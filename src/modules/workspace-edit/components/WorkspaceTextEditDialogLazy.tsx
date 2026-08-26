import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { WorkspaceTextEditDialog as DialogType } from "./WorkspaceTextEditDialog";

const Dialog = lazy(() =>
  import("./WorkspaceTextEditDialog").then((module) => ({
    default: module.WorkspaceTextEditDialog,
  })),
);

type Props = ComponentProps<typeof DialogType>;

export function WorkspaceTextEditDialog(props: Props) {
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  );
}
