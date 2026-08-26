import { type ComponentProps, lazy, Suspense } from "react";
import type { OutlinePanel as OutlinePanelType } from "./components/OutlinePanel";

const OutlinePanelInner = lazy(() =>
  import("./components/OutlinePanel").then((module) => ({
    default: module.OutlinePanel,
  })),
);

type Props = ComponentProps<typeof OutlinePanelType>;

export function OutlinePanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <OutlinePanelInner {...props} />
    </Suspense>
  );
}
