import { lazy, Suspense, type ComponentProps } from "react";

const LazyPreviewStack = lazy(() =>
  import("./PreviewStack").then((module) => ({
    default: module.PreviewStack,
  })),
);

type PreviewStackProps = ComponentProps<
  typeof import("./PreviewStack").PreviewStack
>;

export function PreviewStackLazy(props: PreviewStackProps) {
  if (!props.tabs.some((tab) => tab.kind === "preview" && !tab.cold)) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyPreviewStack {...props} />
    </Suspense>
  );
}
