import { type ComponentProps, lazy, Suspense } from "react";
import type { ProblemsPanel as ProblemsPanelType } from "./components/ProblemsPanel";

const ProblemsPanelInner = lazy(() =>
  import("./components/ProblemsPanel").then((module) => ({
    default: module.ProblemsPanel,
  })),
);

type Props = ComponentProps<typeof ProblemsPanelType>;

export function ProblemsPanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <ProblemsPanelInner {...props} />
    </Suspense>
  );
}
