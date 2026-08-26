import { lazy, Suspense, type ComponentProps } from "react";
import type { QuickOpenDialog as QuickOpenDialogType } from "./QuickOpenDialog";

const QuickOpenDialogInner = lazy(() =>
  import("./QuickOpenDialog").then((module) => ({
    default: module.QuickOpenDialog,
  })),
);

type Props = ComponentProps<typeof QuickOpenDialogType>;

export function QuickOpenDialog(props: Props) {
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <QuickOpenDialogInner {...props} />
    </Suspense>
  );
}
