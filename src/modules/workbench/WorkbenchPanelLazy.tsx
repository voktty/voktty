import { lazy, Suspense, type ComponentProps } from "react";
import type { WorkbenchPanel as WorkbenchPanelType } from "./WorkbenchPanel";

const Inner = lazy(() =>
  import("./WorkbenchPanel").then((module) => ({ default: module.WorkbenchPanel })),
);

export function WorkbenchPanel(props: ComponentProps<typeof WorkbenchPanelType>) {
  return (
    <Suspense fallback={<div className="h-full animate-pulse bg-muted/10" />}>
      <Inner {...props} />
    </Suspense>
  );
}
