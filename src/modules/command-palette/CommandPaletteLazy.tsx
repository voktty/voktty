import {
  type ComponentProps,
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";
import type { CommandPalette as Palette } from "@/modules/command-palette/CommandPalette";

const LazyPalette = lazy(() =>
  import("@/modules/command-palette/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);

export function CommandPalette(props: ComponentProps<typeof Palette>) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (props.open) setOpened(true);
  }, [props.open]);
  if (!props.open && !opened) return null;
  return (
    <Suspense fallback={null}>
      <LazyPalette {...props} />
    </Suspense>
  );
}
