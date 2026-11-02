/** A resource owner pinned to one native backend incarnation. */
export type MemoryTransport = Readonly<{
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  check: () => void;
  retain: () => MemoryTransport;
  /** Retryable; resolves only after this owner's requests and cleanup settle. */
  release: () => Promise<void>;
}>;
