import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import type { ViewSpace, WorkspaceRect } from "@/modules/spaces";
import type { Tab } from "@/modules/tabs";
import { planWorkspaceDrop } from "../lib/planWorkspaceDrop";
import type { SpaceGeometry } from "../lib/spaceGeometry";
import { useWorkspaceDrag } from "../lib/useWorkspaceDrag";

type Props = {
  viewSpace: ViewSpace;
  geometry: SpaceGeometry;
  viewSpaces: readonly ViewSpace[];
  tabs: readonly Tab[];
};

export function WorkspaceDropOverlay({
  viewSpace,
  geometry,
  viewSpaces,
  tabs,
}: Props) {
  const { t } = useTranslation();
  const drag = useWorkspaceDrag();
  const resourceSource =
    drag.source?.kind === "file" || drag.source?.kind === "directory";
  if (!drag.source || (!drag.active && !resourceSource)) return null;
  const source = drag.source;

  const plan = drag.target
    ? planWorkspaceDrop({
        source: drag.source,
        target: drag.target,
        viewSpaces,
        tabs,
      })
    : null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-35"
      aria-hidden
      data-workspace-drop-overlay
    >
      {geometry.slots.map((slot) => (
        <SlotDropZones
          key={slot.slotId}
          viewSpaceId={viewSpace.id}
          slotId={slot.slotId}
          rect={slot.rect}
          activeTarget={drag.target}
          accepted={plan?.accepted === true}
          active={drag.active}
          label={
            resourceSource
              ? t("spaces.resourceDropReady")
              : t("spaces.dropReady")
          }
          disabled={
            source.kind === "space-member" &&
            source.viewSpaceId === viewSpace.id &&
            source.slotId === slot.slotId
          }
        />
      ))}
    </div>
  );
}

export function WorkspaceDragLiveRegion({
  viewSpaces,
  tabs,
}: {
  viewSpaces: readonly ViewSpace[];
  tabs: readonly Tab[];
}) {
  const { t } = useTranslation();
  const drag = useWorkspaceDrag();
  if (!drag.active || !drag.source) return null;
  const plan = drag.target
    ? planWorkspaceDrop({
        source: drag.source,
        target: drag.target,
        viewSpaces,
        tabs,
      })
    : null;
  const resourceSource =
    drag.source.kind === "file" || drag.source.kind === "directory";
  const message = !plan
    ? t(resourceSource ? "spaces.resourceDragReady" : "spaces.dragReady")
    : plan.accepted
      ? t(resourceSource ? "spaces.resourceDropReady" : "spaces.dropReady")
      : plan.reason === "max-slots"
        ? t("spaces.maxSlots")
        : plan.reason === "renderer-capacity"
          ? t("spaces.rendererCapacity")
          : t("spaces.invalidDrop");
  return (
    <div className="sr-only" aria-live="polite">
      {message}
    </div>
  );
}

function SlotDropZones({
  viewSpaceId,
  slotId,
  rect,
  activeTarget,
  accepted,
  active,
  label,
  disabled,
}: {
  viewSpaceId: ViewSpace["id"];
  slotId: string;
  rect: WorkspaceRect;
  activeTarget: ReturnType<typeof useWorkspaceDrag>["target"];
  accepted: boolean;
  active: boolean;
  label: string;
  disabled: boolean;
}) {
  const data = {
    "data-workspace-view-space-id": viewSpaceId,
    "data-workspace-slot-id": slotId,
  };
  const isTarget =
    activeTarget?.kind === "slot" &&
    activeTarget.viewSpaceId === viewSpaceId &&
    activeTarget.slotId === slotId;
  const className = cn(
    "absolute rounded-md border transition-colors",
    isTarget &&
      (accepted
        ? "border-primary/90 bg-primary/25 shadow-[inset_0_0_0_1px_var(--primary)]"
        : "border-destructive/90 bg-destructive/20"),
  );

  return (
    <div
      className="pointer-events-none absolute"
      style={rectStyle(rect)}
      data-workspace-drop-disabled={disabled ? "true" : undefined}
    >
      <div
        {...data}
        data-workspace-drop-kind="slot"
        className={cn(
          className,
          disabled ? "pointer-events-none" : "pointer-events-auto",
          "inset-0",
        )}
        onPointerDown={(event) => event.preventDefault()}
      >
        {active && isTarget && accepted ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/35 px-4 text-center text-sm font-medium text-foreground backdrop-blur-[1px]">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function rectStyle(rect: WorkspaceRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}
