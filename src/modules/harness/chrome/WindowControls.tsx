import { WindowControls as UnifiedWindowControls } from "@/components/WindowControls";

export type HarnessWindowControlsProps = {
  className?: string;
};

export function WindowControls({ className }: HarnessWindowControlsProps) {
  return <UnifiedWindowControls variant="strip" className={className} />;
}

