import {
  createContext,
  useContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  createTerminalSurfaces,
  type TerminalSurfaceRect,
  type TerminalSurfaceSnapshot,
} from "@/modules/terminal/lib/terminalSurfaceLayout";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";

const SurfaceContext = createContext<ReturnType<
  typeof createTerminalSurfaces
> | null>(null);
const EMPTY: TerminalSurfaceSnapshot = Object.freeze({
  root: null,
  entries: Object.freeze([]),
});
const noopSubscribe = () => () => {};
const getEmpty = () => EMPTY;

export function useTerminalSurfaceController() {
  return useContext(SurfaceContext);
}

export function TerminalSurfaceProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(createTerminalSurfaces);
  return (
    <SurfaceContext.Provider value={controller}>
      {children}
    </SurfaceContext.Provider>
  );
}

export function useTerminalSurfaces() {
  const controller = useContext(SurfaceContext);
  return useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? getEmpty,
    getEmpty,
  );
}

function bounds(node: HTMLElement): TerminalSurfaceRect {
  const { left, top, width, height } = node.getBoundingClientRect();
  return { left, top, width, height };
}

function observeBounds(
  node: HTMLElement,
  publish: (rect: TerminalSurfaceRect) => void,
) {
  let live = true;
  let frame: number | undefined;
  const measure = () => {
    if (live) publish(bounds(node));
  };
  const schedule = () => {
    if (frame !== undefined || !live) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  measure();
  return () => {
    live = false;
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

export function useTerminalSurfaceRoot(
  node: RefObject<HTMLDivElement | null>,
  observing: boolean,
) {
  const controller = useContext(SurfaceContext);
  useLayoutEffect(() => {
    if (!controller || !node.current || !observing) return;
    const release = observeBounds(node.current, controller.setRoot);
    return () => {
      release();
      controller.setRoot(null);
    };
  }, [controller, node, observing]);
}

export function TerminalSurface({
  tabKey,
  ownerTabKey,
  projectCwd,
  visible,
  focused,
  onFocus,
  layoutKey,
  slotKey,
  children,
}: {
  tabKey: TabKey;
  ownerTabKey: TabKey;
  projectCwd: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
  layoutKey?: string | number;
  slotKey?: string;
  children?: ReactNode;
}) {
  const controller = useContext(SurfaceContext);
  const node = useRef<HTMLDivElement>(null);
  const onFocusRef = useRef(onFocus);
  useLayoutEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);
  const focus = useCallback(() => onFocusRef.current?.(), []);
  const latest = useRef({
    tabKey,
    ownerTabKey,
    projectCwd,
    focused,
    onFocus: focus,
    layoutKey,
    slotKey,
  });
  const receipt = useRef<ReturnType<
    ReturnType<typeof createTerminalSurfaces>["register"]
  > | null>(null);
  useLayoutEffect(() => {
    latest.current = {
      tabKey,
      ownerTabKey,
      projectCwd,
      focused,
      onFocus: focus,
      layoutKey,
      slotKey,
    };
    if (node.current)
      receipt.current?.update({
        ...latest.current,
        rect: bounds(node.current),
      });
  }, [tabKey, ownerTabKey, projectCwd, focused, focus, layoutKey, slotKey]);
  useLayoutEffect(() => {
    if (!controller || !visible || !node.current) return;
    const current = controller.register({
      ...latest.current,
      rect: bounds(node.current),
    });
    receipt.current = current;
    const release = observeBounds(node.current, (rect) =>
      current.update({ ...latest.current, rect }),
    );
    return () => {
      release();
      current.release();
      if (receipt.current === current) receipt.current = null;
    };
  }, [controller, visible]);
  return (
    <div
      ref={node}
      data-terminal-surface={tabKey}
      className="relative h-full min-h-0 min-w-0 w-full"
    >
      {children}
    </div>
  );
}
