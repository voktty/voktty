import { lazy, Suspense, type ComponentProps } from "react";
import type { PeekPanel as PeekPanelType } from "./components/PeekPanel";

const PeekPanelInner = lazy(() =>
  import("./components/PeekPanel").then((module) => ({
    default: module.PeekPanel,
  })),
);

type Props = ComponentProps<typeof PeekPanelType>;

export function PeekPanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <PeekPanelInner {...props} />
    </Suspense>
  );
}
