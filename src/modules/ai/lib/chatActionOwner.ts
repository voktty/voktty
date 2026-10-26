const MAX_PENDING_ACTIONS = 256;
let pendingActions = 0;

export function createChatActionOwner<T>(deps: {
  isCurrent: () => boolean;
  getChat: () => T | undefined;
}) {
  let active = true;
  let original = deps.getChat();
  let pending = false;
  let epoch = 0;

  const isCurrent = () => {
    if (!active) return false;
    const registered = deps.getChat();
    if (
      !deps.isCurrent() ||
      (original !== undefined && registered !== original)
    ) {
      active = false;
      return false;
    }
    original ??= registered;
    return true;
  };

  return {
    isCurrent,
    retire: () => {
      active = false;
    },
    cancelPending: () => {
      epoch++;
    },
    resolve(create?: () => T): T | undefined {
      if (!isCurrent()) return undefined;
      const chat = original ?? create?.();
      if (!isCurrent() || chat === undefined) return undefined;
      if (deps.getChat() !== chat) {
        active = false;
        return undefined;
      }
      original = chat;
      return chat;
    },
    async run(
      task: (isActionCurrent: () => boolean) => Promise<boolean>,
    ): Promise<boolean> {
      if (!isCurrent() || pending || pendingActions >= MAX_PENDING_ACTIONS)
        return false;
      pending = true;
      pendingActions++;
      const admission = epoch;
      try {
        return await task(() => admission === epoch && isCurrent());
      } catch {
        return false;
      } finally {
        pending = false;
        pendingActions--;
      }
    },
  };
}
