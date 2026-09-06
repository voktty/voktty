import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { GitCommitDiffStack as GitCommitDiffStackType } from "./GitCommitDiffStack";

const GitCommitDiffStackInner = lazy(() =>
  import("./GitCommitDiffStack").then((m) => ({
    default: m.GitCommitDiffStack,
  })),
);

type Props = ComponentProps<typeof GitCommitDiffStackType>;

export function GitCommitDiffStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <GitCommitDiffStackInner {...props} />
    </Suspense>
  );
}
