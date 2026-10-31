import { useChatStore, type Live } from "@/modules/ai/store/chatStore";

let observers = 0;

export function subscribeAiFileRoot(
  listener: () => void,
  onUnavailable: () => void = listener,
): () => void {
  if (observers >= 256) throw new RangeError("AI root observers are busy");
  observers += 1;
  let active = true;
  let binding: { live: Live; release: () => void } | null = null;
  let releaseStore = () => {};
  const release = () => {
    if (!active) return;
    active = false;
    observers -= 1;
    releaseStore();
    const previous = binding;
    binding = null;
    previous?.release();
  };
  const bind = (live: Live) => {
    const previous = binding;
    const next = { live, release: () => {} };
    binding = next;
    previous?.release();
    if (!active || binding !== next) return;
    const unsubscribe = live.subscribeFileRootContext?.(() => {
      if (active && binding === next) listener();
    });
    if (unsubscribe) {
      if (active && binding === next) next.release = unsubscribe;
      else unsubscribe();
    }
  };
  try {
    releaseStore = useChatStore.subscribe(() => {
      const live = useChatStore.getState().live;
      if (!active || live === binding?.live) return;
      try {
        bind(live);
      } catch {
        release();
        onUnavailable();
        return;
      }
      if (active) listener();
    });
    bind(useChatStore.getState().live);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
