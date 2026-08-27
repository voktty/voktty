import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  withDots,
  children,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
  withDots?: boolean
}) {
  const showDots = withDots ?? (!withHandle && !children);

  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group/handle relative flex items-center justify-center bg-transparent transition-colors duration-150 ring-offset-background outline-none",
        "w-px aria-[orientation=vertical]:w-px aria-[orientation=vertical]:h-full",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-3.5 after:-translate-x-1/2 after:z-10",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-3.5 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "hover:bg-border/80 data-[resize-handle-state=drag]:bg-primary",
        "focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      {showDots && (
        <div
          className={cn(
            "pointer-events-none z-10 flex items-center justify-center gap-1 transition-all duration-150",
            "flex-col [[aria-orientation=horizontal]_&]:flex-row",
            "opacity-30 group-hover/handle:opacity-100 group-data-[resize-handle-state=drag]/handle:opacity-100 group-hover/handle:scale-110"
          )}
        >
          <span className="size-[2.5px] rounded-full bg-foreground/60 group-hover/handle:bg-primary transition-colors" />
          <span className="size-[2.5px] rounded-full bg-foreground/60 group-hover/handle:bg-primary transition-colors" />
          <span className="size-[2.5px] rounded-full bg-foreground/60 group-hover/handle:bg-primary transition-colors" />
        </div>
      )}
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border group-hover/handle:bg-primary transition-colors" />
      )}
      {children}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
