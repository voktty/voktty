import {
  cloneElement,
  memo,
  type ReactElement,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

export const TRANSCRIPT_POOL_LIMIT = 12;

type PooledProps = { visible?: boolean; parked?: boolean };

export type TranscriptPoolEntry = {
  id: string;
  container: HTMLDivElement;
  element: ReactElement<PooledProps>;
  onMouseDown?: () => void;
  host: HTMLElement | null;
};

/** Keeps recently closed transcripts mounted so reopening a pane reuses its DOM. */
export class TranscriptPool {
  private entries = new Map<string, TranscriptPoolEntry>();
  private listeners = new Set<() => void>();
  private snapshot: TranscriptPoolEntry[] = [];

  constructor(private readonly limit = TRANSCRIPT_POOL_LIMIT) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  show(
    id: string,
    host: HTMLElement,
    element: ReactElement<PooledProps>,
    onMouseDown?: () => void,
  ) {
    const previous = this.entries.get(id);
    const container = previous?.container ?? createContainer();
    if (container.parentElement !== host) host.appendChild(container);
    if (
      previous?.host === host &&
      previous.onMouseDown === onMouseDown &&
      sameElement(previous.element, element)
    ) {
      return;
    }
    if (previous?.onMouseDown) {
      container.removeEventListener("mousedown", previous.onMouseDown);
    }
    if (onMouseDown) container.addEventListener("mousedown", onMouseDown);
    this.entries.delete(id);
    this.entries.set(id, { id, container, element, onMouseDown, host });
    this.emit();
  }

  park(id: string, host: HTMLElement) {
    const entry = this.entries.get(id);
    if (!entry || entry.host !== host) return;
    entry.container.remove();
    if (entry.onMouseDown) {
      entry.container.removeEventListener("mousedown", entry.onMouseDown);
    }
    this.entries.set(id, {
      ...entry,
      host: null,
      onMouseDown: undefined,
      element: cloneElement(entry.element, { visible: false, parked: true }),
    });
    this.trim();
    this.emit();
  }

  private trim() {
    let parked = 0;
    for (const entry of this.entries.values()) {
      if (!entry.host) parked += 1;
    }
    for (const entry of [...this.entries.values()]) {
      if (parked <= this.limit) break;
      if (entry.host) continue;
      this.entries.delete(entry.id);
      parked -= 1;
    }
  }

  private emit() {
    this.snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener();
  }
}

function sameElement(
  previous: ReactElement<PooledProps>,
  next: ReactElement<PooledProps>,
) {
  if (previous === next) return true;
  if (previous.type !== next.type || previous.key !== next.key) return false;
  const before = previous.props as Record<string, unknown>;
  const after = next.props as Record<string, unknown>;
  const keys = Object.keys(before);
  return (
    keys.length === Object.keys(after).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(after, key) &&
        Object.is(before[key], after[key]),
    )
  );
}

function createContainer() {
  const node = document.createElement("div");
  node.className = "contents";
  return node;
}

export const TranscriptPoolOutlet = memo(function TranscriptPoolOutlet({
  pool,
}: {
  pool: TranscriptPool;
}) {
  const entries = useSyncExternalStore(
    pool.subscribe,
    pool.getSnapshot,
    pool.getSnapshot,
  );
  return entries.map((entry) => <PooledEntry key={entry.id} entry={entry} />);
});

const PooledEntry = memo(function PooledEntry({
  entry,
}: {
  entry: TranscriptPoolEntry;
}) {
  return createPortal(
    <div className="contents">{entry.element}</div>,
    entry.container,
  );
});

export function PooledTranscript({
  pool,
  sessionId,
  onMouseDown,
  children,
}: {
  pool?: TranscriptPool;
  sessionId: string;
  onMouseDown?: () => void;
  children?: ReactElement<PooledProps>;
}) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = host.current;
    if (!pool || !node) return;
    return () => pool.park(sessionId, node);
  }, [pool, sessionId]);

  useLayoutEffect(() => {
    if (pool && host.current && children) {
      pool.show(sessionId, host.current, children, onMouseDown);
    }
  });

  if (!pool) return children ?? null;
  return <div ref={host} className="contents" />;
}
