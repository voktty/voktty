import { cn } from "@/lib/utils";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { PreviewTab, Tab } from "@/modules/tabs";
import { useEffect, useRef } from "react";
import { PreviewPane, type PreviewPaneHandle } from "./PreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onUrlChange: (id: number, url: string) => void;
  registerHandle: (id: number, handle: PreviewPaneHandle | null) => void;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function PreviewStack({
  tabs,
  activeId,
  onUrlChange,
  registerHandle,
  placements,
}: Props) {
  const previews = tabs.filter(
    (t): t is PreviewTab => t.kind === "preview" && !t.cold,
  );

  const registerRef = useRef(registerHandle);
  const urlChangeRef = useRef(onUrlChange);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    urlChangeRef.current = onUrlChange;
  }, [onUrlChange]);

  const refCallbacks = useRef(
    new Map<number, (h: PreviewPaneHandle | null) => void>(),
  );
  const urlCallbacks = useRef(new Map<number, (url: string) => void>());

  const getRefCallback = (id: number) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (h: PreviewPaneHandle | null) => registerRef.current(id, h);
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };
  const getUrlCallback = (id: number) => {
    let cb = urlCallbacks.current.get(id);
    if (!cb) {
      cb = (url: string) => urlChangeRef.current(id, url);
      urlCallbacks.current.set(id, cb);
    }
    return cb;
  };

  useEffect(() => {
    const live = new Set(previews.map((t) => t.id));
    for (const id of refCallbacks.current.keys()) {
      if (!live.has(id)) refCallbacks.current.delete(id);
    }
    for (const id of urlCallbacks.current.keys()) {
      if (!live.has(id)) urlCallbacks.current.delete(id);
    }
  }, [previews]);

  if (previews.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {previews.map((t) => {
        const placement = placements?.get(t.id);
        const visible = placements
          ? placement !== undefined
          : t.id === activeId;
        return (
          <div
            key={t.id}
            data-space-slot={placement?.slotId}
            data-space-tab={t.id}
            className={cn(
              "absolute",
              !visible && "invisible pointer-events-none",
            )}
            style={
              placement
                ? {
                    left: `${placement.rect.x * 100}%`,
                    top: `${placement.rect.y * 100}%`,
                    width: `${placement.rect.width * 100}%`,
                    height: `${placement.rect.height * 100}%`,
                    pointerEvents: "auto",
                  }
                : { inset: 0, pointerEvents: visible ? "auto" : "none" }
            }
            aria-hidden={!visible}
          >
            <PreviewPane
              ref={getRefCallback(t.id)}
              url={t.url}
              visible={visible}
              onUrlChange={getUrlCallback(t.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
